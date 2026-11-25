import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Rendición del entregador: cobra los pedidos que llevó (efectivo/tarjeta), le paga el delivery en efectivo
// y calcula el neto (efectivo cobrado − delivery). Se prueba en un esquema temporal que se borra al final.
const schema = `test_rendicion_delivery_${Date.now()}`;
const admin = new pg.Client(pool.options);
await admin.connect();
let server;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
    // La migración se puede correr sobre una base que ya la tiene.
    await setup.query(await readFile(new URL('./migrations/20261125_rendicion_delivery.sql', import.meta.url), 'utf8'));
    await setup.query('COMMIT');
  } finally { setup.release(); }

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, raw = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: auth[role] }, body: body ? JSON.stringify(body) : undefined });
    if (raw) { assert.equal(response.status, status); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const post = (path, body, opts = {}) => call(path, { method: 'POST', body: { clave: randomUUID(), ...body }, ...opts });

  // --- Datos: comida 30.000 + delivery 15.000 = 45.000 por pedido (el ejemplo del local).
  const ana = (await pool.query("INSERT INTO entregador_delivery(nombre_completo) VALUES('Ana Moto') RETURNING identregador_delivery AS id")).rows[0].id;
  const beto = (await pool.query("INSERT INTO entregador_delivery(nombre_completo) VALUES('Beto Bici') RETURNING identregador_delivery AS id")).rows[0].id;
  const client = (await pool.query("SELECT idcliente, fk_idzona_cliente FROM cliente WHERE ruc='20123456789'")).rows[0];
  await pool.query('UPDATE zona_cliente SET precio_delivery=15000 WHERE idzona_cliente=$1', [client.fk_idzona_cliente]);
  const plato = (await pool.query("SELECT idproducto_menu AS id FROM producto_menu WHERE nombre='Plato de la casa'")).rows[0].id;
  await pool.query('UPDATE producto_menu SET stock_actual=100, precio_venta=30000 WHERE idproducto_menu=$1', [plato]);
  const forma = async name => (await pool.query('SELECT idforma_pago FROM forma_pago WHERE nombre=$1', [name])).rows[0].idforma_pago;
  const cash = await forma('Efectivo'), card = await forma('Débito'), transfer = await forma('Transferencia');

  // Sin entregador al tomar el pedido: se asigna cuando sale.
  const order = async () => (await post('/api/pedidos', { tipo_entrega: 'DELIVERY', fk_idcliente: client.idcliente, monto_descuento: 0, detalles: [{ fk_idproducto_menu: plato, cantidad: 1 }] })).pedido;
  const assign = (pedido, courier) => post(`/api/pagos-delivery/pedidos/${pedido.idpedido}/entregador`, { fk_identregador_delivery: courier });
  const pending = courier => call(`/api/pagos-delivery/rendicion/${courier}`);
  const pays = (formaId, importe) => [{ fk_idforma_pago: formaId, importe }];

  // Sin caja abierta no se puede rendir.
  const sinCaja = await order();
  await assign(sinCaja, beto);
  assert.equal((await pending(beto)).caja_abierta, false);
  assert.match((await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: beto, pedidos: [{ idpedido: sinCaja.idpedido, pagos: pays(cash, 45000) }] }, { status: 400 })).error, /Abrí una caja/);
  await post('/api/cajas/abrir', { monto_inicial: 100000 });
  const box = (await call('/api/cajas')).abierta;
  const arqueo = async formaId => {
    const a = (await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(x => x.fk_idforma_pago === formaId);
    return Number(a?.total_ingresos || 0) - Number(a?.total_egresos || 0);
  };

  // --- Permisos
  await call(`/api/pagos-delivery/rendicion/${ana}`, { role: 'mozo', status: 403 });

  // --- Caso 1: dos pedidos todo en efectivo → cobró 90.000, rinde 60.000 y se queda con 30.000.
  const a1 = await order(), a2 = await order();
  assert.equal(Number(a1.monto_total), 45000);
  await assign(a1, ana); await assign(a2, ana);
  let p = await pending(ana);
  assert.deepEqual(p.pedidos.map(x => [x.idpedido, x.saldo, x.delivery_a_pagar]), [[a1.idpedido, 45000, 15000], [a2.idpedido, 45000, 15000]]);
  assert.equal(p.fk_idforma_efectivo, cash);
  assert.deepEqual((await call('/api/pagos-delivery/rendicion')).entregadores.map(e => [e.nombre, e.pedidos]), [['Ana Moto', 2], ['Beto Bici', 1]]);
  const cashBefore = await arqueo(cash);
  const rend1Body = { fk_identregador_delivery: ana, pedidos: [a1, a2].map(x => ({ idpedido: x.idpedido, pagos: pays(cash, 45000) })) };
  assert.match((await post('/api/pagos-delivery/rendir', { ...rend1Body, neto: 1 }, { status: 409 })).error, /El neto cambió/);
  const r1 = (await post('/api/pagos-delivery/rendir', { ...rend1Body, neto: 60000 })).rendicion;
  assert.deepEqual([r1.efectivo_cobrado, r1.otros_cobrado, r1.delivery_pagado, r1.neto, r1.pedidos.length], [90000, 0, 30000, 60000, 2]);
  assert.equal(await arqueo(cash) - cashBefore, 60000, 'En la caja queda lo que entregó en mano');
  const states = (await pool.query('SELECT p.estado::text AS pedido, c.estado::text AS cuenta FROM pedido p JOIN cuenta c ON c.idcuenta=p.fk_idcuenta WHERE p.idpedido = ANY($1)', [[a1.idpedido, a2.idpedido]])).rows;
  assert.ok(states.every(s => s.pedido === 'pagado' && s.cuenta === 'cerrada'), JSON.stringify(states));
  assert.equal((await pending(ana)).pedidos.length, 0, 'Ya no queda nada por rendir');
  assert.match((await post('/api/pagos-delivery/rendir', rend1Body, { status: 409 })).error, /no está pendiente/, 'No se rinde dos veces');
  // El delivery figura pagado en Pagos a delivery y su pago no se anula suelto.
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const summary = await call(`/api/pagos-delivery?inicio=${today}&fin=${today}`);
  assert.deepEqual(summary.entregadores.find(e => e.id === ana).pendiente, 0);
  assert.equal(summary.pagos.find(x => x.idpago_delivery === r1.fk_idpago_delivery).idrendicion_delivery, r1.idrendicion_delivery);
  assert.match((await post(`/api/pagos-delivery/${r1.fk_idpago_delivery}/anular`, { motivo: 'x' }, { status: 409 })).error, /Anulá la rendición/);

  // --- Caso 2: dos pedidos todo con tarjeta → el local le paga 30.000 de la caja.
  const b1 = await order(), b2 = await order();
  await assign(b1, beto); await assign(b2, beto);
  const [cash2, card2] = [await arqueo(cash), await arqueo(card)];
  const r2 = (await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: beto, pedidos: [b1, b2].map(x => ({ idpedido: x.idpedido, pagos: pays(card, 45000) })) })).rendicion;
  assert.deepEqual([r2.efectivo_cobrado, r2.otros_cobrado, r2.delivery_pagado, r2.neto], [0, 90000, 30000, -30000]);
  assert.equal(await arqueo(card) - card2, 90000);
  assert.equal(await arqueo(cash) - cash2, -30000);
  assert.deepEqual((await pending(beto)).pedidos.map(x => x.idpedido), [sinCaja.idpedido], 'El que no se rindió queda pendiente');

  // --- Mixto: pedido dividido efectivo/tarjeta, pedido con transferencia anticipada y pedido todavía en COCINA.
  const m1 = await order(), m2 = await order();
  await post(`/api/pedidos/${m2.idpedido}/pago-anticipado`, { fk_idforma_pago: transfer, importe: 45000 });
  await assign(m1, ana); await assign(m2, ana);
  p = await pending(ana);
  assert.deepEqual(p.pedidos.map(x => [x.estado, x.saldo, x.cobrado_antes]), [['en_preparacion', 45000, 0], ['en_preparacion', 0, 45000]]);
  // El cobro tiene que ser igual al saldo.
  assert.match((await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: ana, pedidos: [{ idpedido: m1.idpedido, pagos: pays(cash, 40000) }] }, { status: 400 })).error, /debe ser igual al saldo/);
  const r3 = (await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: ana, pedidos: [
    { idpedido: m1.idpedido, pagos: [{ fk_idforma_pago: cash, importe: 20000 }, { fk_idforma_pago: card, importe: 25000 }] },
    { idpedido: m2.idpedido, pagos: [] }] })).rendicion;
  assert.deepEqual([r3.efectivo_cobrado, r3.otros_cobrado, r3.delivery_pagado, r3.neto], [20000, 25000, 30000, -10000]);
  assert.deepEqual(r3.pedidos.map(x => [x.cobrado_antes, x.formas_cobro]), [[0, 'Efectivo, Débito'], [45000, null]]);
  assert.ok((await pool.query('SELECT estado::text FROM pedido WHERE idpedido = ANY($1)', [[m1.idpedido, m2.idpedido]])).rows.every(x => x.estado === 'pagado'));

  // --- Comprobante
  const ticket = await call(`/api/pagos-delivery/rendiciones/${r3.idrendicion_delivery}/ticket.pdf`, { raw: true });
  assert.equal(Buffer.from(await ticket.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const list = await call(`/api/pagos-delivery/rendiciones?inicio=${today}&fin=${today}`);
  assert.deepEqual(list.items.map(x => x.idrendicion_delivery), [r3, r2, r1].map(x => x.idrendicion_delivery));

  // --- Anular la rendición 1: el delivery vuelve a la caja; los cobros se mantienen y el delivery queda por rendir.
  const cash3 = await arqueo(cash);
  await post(`/api/pagos-delivery/rendiciones/${r1.idrendicion_delivery}/anular`, { motivo: '' }, { status: 400 });
  const annulled = (await post(`/api/pagos-delivery/rendiciones/${r1.idrendicion_delivery}/anular`, { motivo: 'Se cargó mal' })).rendicion;
  assert.equal(annulled.estado, 'anulada');
  assert.equal(await arqueo(cash) - cash3, 30000);
  p = await pending(ana);
  assert.deepEqual(p.pedidos.map(x => [x.idpedido, x.saldo, x.delivery_a_pagar]), [[a1.idpedido, 0, 15000], [a2.idpedido, 0, 15000]]);
  // Se rinde de nuevo: no hay nada que cobrar, solo pagarle el delivery.
  const r4 = (await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: ana, pedidos: p.pedidos.map(x => ({ idpedido: x.idpedido, pagos: [] })) })).rendicion;
  assert.deepEqual([r4.efectivo_cobrado, r4.delivery_pagado, r4.neto], [0, 30000, -30000]);
  await post(`/api/pagos-delivery/rendiciones/${r1.idrendicion_delivery}/anular`, { motivo: 'Otra vez' }, { status: 409 });
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auditoria WHERE accion IN ('RENDICION_DELIVERY','RENDICION_DELIVERY_ANULADA')")).rows[0].n, 5);

  // --- Otro entregador no puede rendir un pedido ajeno; un entregador inactivo no se puede asignar.
  const o = await order();
  await assign(o, beto);
  assert.match((await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: ana, pedidos: [{ idpedido: o.idpedido, pagos: pays(cash, 45000) }] }, { status: 409 })).error, /no está pendiente/);
  await pool.query('UPDATE entregador_delivery SET activo=false WHERE identregador_delivery=$1', [ana]);
  await assign(o, ana).catch(() => {});
  assert.match((await post(`/api/pagos-delivery/pedidos/${o.idpedido}/entregador`, { fk_identregador_delivery: ana }, { status: 400 })).error, /entregador activo/);

  // --- Dos rendiciones simultáneas del mismo pedido: solo una se registra.
  const both = await Promise.all([0, 1].map(() => fetch(base + '/api/pagos-delivery/rendir', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: auth.admin },
    body: JSON.stringify({ clave: randomUUID(), fk_identregador_delivery: beto, pedidos: [{ idpedido: o.idpedido, pagos: pays(cash, 45000) }] }) })));
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);

  console.log('PASS: rendición del entregador (efectivo, tarjeta, mixto, pago anticipado, pedido en cocina, neto en caja, anulación, comprobante y concurrencia).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
