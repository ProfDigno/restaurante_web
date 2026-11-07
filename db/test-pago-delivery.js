import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Pagos a delivery: pendiente por entregador y período, pago desde caja (gasto "Pago a delivery"),
// sin pagos dobles, anulación (vuelve a caja), pedidos sin entregador, aviso en caja, permisos y reportes.
const schema = `test_pago_delivery_${Date.now()}`;
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
    await setup.query('COMMIT');
  } finally { setup.release(); }

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','encargado','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, raw = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: auth[role] }, body: body ? JSON.stringify(body) : undefined });
    if (raw) { assert.equal(response.status, status); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const post = (path, body, opts = {}) => call(path, { method: 'POST', body: { clave: randomUUID(), ...body }, ...opts });

  // --- Datos: dos entregadores, cliente de Zona Centro (delivery 1.500), caja abierta
  const ana = (await pool.query("INSERT INTO entregador_delivery(nombre_completo) VALUES('Ana Moto') RETURNING identregador_delivery AS id")).rows[0].id;
  const beto = (await pool.query("INSERT INTO entregador_delivery(nombre_completo) VALUES('Beto Bici') RETURNING identregador_delivery AS id")).rows[0].id;
  const clientId = (await pool.query("SELECT idcliente FROM cliente WHERE ruc='20123456789'")).rows[0].idcliente;
  const plato = (await pool.query("SELECT idproducto_menu AS id FROM producto_menu WHERE nombre='Plato de la casa'")).rows[0].id;
  await pool.query('UPDATE producto_menu SET stock_actual=100 WHERE idproducto_menu=$1', [plato]);
  const cash = (await pool.query('SELECT idforma_pago FROM forma_pago WHERE es_default')).rows[0].idforma_pago;
  await post('/api/cajas/abrir', { monto_inicial: 100000 });
  const order = async courier => (await post('/api/pedidos', { tipo_entrega: 'DELIVERY', fk_idcliente: clientId, fk_identregador_delivery: courier, monto_descuento: 0, detalles: [{ fk_idproducto_menu: plato, cantidad: 1 }] })).pedido;
  const charge = async pedido => {
    await post(`/api/pedidos/${pedido.idpedido}/terminar`, { version_web: pedido.version_web });
    await post(`/api/pedidos/cuentas/${pedido.fk_idcuenta}/cobrar`, { pagos: [{ fk_idforma_pago: cash, importe: Number(pedido.monto_total) }] });
  };
  const o1 = await order(ana), o2 = await order(ana), o3 = await order(beto), o4 = await order(null), o5 = await order(ana);
  assert.equal(Number(o1.monto_delivery), 1500);
  for (const p of [o1, o2, o3, o4]) await charge(p);
  await post(`/api/pedidos/${o5.idpedido}/anular`, { motivo: 'Prueba', devoluciones: [] });

  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const path = (extra = '') => `/api/pagos-delivery?inicio=${today}&fin=${today}${extra}`;

  // --- Permisos y validación
  await call(path(), { role: 'mozo', status: 403 });
  await call(path(), { role: 'encargado' });
  await call(`/api/pagos-delivery?inicio=${today}&fin=2000-01-01`, { status: 400 });

  // --- Pendiente por entregador (el anulado no cuenta; el pedido sin entregador va aparte)
  let data = await call(path());
  const courier = (d, idValue) => d.entregadores.find(e => e.id === idValue);
  assert.deepEqual([courier(data, ana).pedidos, courier(data, ana).pendiente, courier(data, beto).pendiente], [2, 3000, 1500]);
  assert.deepEqual(data.resumen, { pedidos: 3, total: 4500, pagado: 0, pendiente: 4500, sin_entregador: { pedidos: 1, total: 1500 } });
  assert.equal(data.sin_entregador[0].idpedido, o4.idpedido);
  const onlyAna = await call(path(`&entregador=${ana}`));
  assert.deepEqual([onlyAna.entregadores.length, onlyAna.resumen.pendiente, onlyAna.filtro], [1, 3000, 'Entregador: Ana Moto']);

  // --- Aviso en caja: delivery cobrado y no pagado (4 pedidos cobrados × 1.500)
  const box = (await call('/api/cajas')).abierta;
  assert.deepEqual((await call('/api/cajas')).delivery_pendiente, { pedidos: 4, total: 6000 });
  const egresosAntes = Number((await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(a => a.fk_idforma_pago === cash).total_egresos);

  // --- Pagar a Ana: si el pendiente cambió se avisa; luego sale de caja como gasto "Pago a delivery"
  const payBody = { fk_identregador_delivery: ana, inicio: today, fin: today, fk_idforma_pago: cash };
  assert.match((await post('/api/pagos-delivery/pagar', { ...payBody, total: 999 }, { status: 409 })).error, /El pendiente cambió/);
  const { pago } = await post('/api/pagos-delivery/pagar', { ...payBody, total: 3000 });
  assert.deepEqual([pago.total, pago.pedidos.length, pago.estado, pago.entregador], [3000, 2, 'pagado', 'Ana Moto']);
  const gasto = (await pool.query('SELECT g.total_gasto, g.estado, t.nombre FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo WHERE g.idgasto=$1', [pago.fk_idgasto])).rows[0];
  assert.deepEqual([Number(gasto.total_gasto), gasto.estado, gasto.nombre], [3000, 'pagado', 'Pago a delivery']);
  const egresosDespues = Number((await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(a => a.fk_idforma_pago === cash).total_egresos);
  assert.equal(egresosDespues - egresosAntes, 3000, 'El pago sale de la caja');
  assert.deepEqual((await call('/api/cajas')).delivery_pendiente, { pedidos: 2, total: 3000 }, 'El aviso de caja baja');
  assert.match((await post('/api/pagos-delivery/pagar', payBody, { status: 409 })).error, /No hay delivery pendiente/, 'No se paga dos veces');
  data = await call(path());
  assert.deepEqual([courier(data, ana).pagado, courier(data, ana).pendiente], [3000, 0]);
  assert.ok(data.pedidos.filter(p => p.identregador === ana).every(p => p.pagado && p.idpago_delivery === pago.idpago_delivery));
  assert.equal(data.pagos[0].idpago_delivery, pago.idpago_delivery);
  await assert.rejects(pool.query('INSERT INTO pago_delivery_pedido(fk_idpago_delivery,fk_idpedido,monto_delivery) VALUES($1,$2,1500)', [pago.idpago_delivery + 0, o1.idpedido]).catch(e => { throw e; }), /duplicate|pago_delivery_pedido/);

  // El gasto no se anula desde Gastos (se liberarían mal los pedidos).
  assert.match((await post(`/api/gastos/${pago.fk_idgasto}/anular`, { motivo: 'x' }, { status: 409 })).error, /Pagos a delivery/);

  // --- Asignar entregador a un pedido que no lo tiene (aunque el cliente ya pagó); no a uno ya pagado al entregador
  assert.equal((await post(`/api/pagos-delivery/pedidos/${o4.idpedido}/entregador`, { fk_identregador_delivery: beto })).entregador, 'Beto Bici');
  assert.match((await post(`/api/pagos-delivery/pedidos/${o1.idpedido}/entregador`, { fk_identregador_delivery: beto }, { status: 409 })).error, /ya está en un pago/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auditoria WHERE accion='ENTREGADOR_ASIGNADO' AND id_entidad=$1", [o4.idpedido])).rows[0].n, 1);
  data = await call(path());
  assert.deepEqual([data.resumen.sin_entregador.pedidos, courier(data, beto).pendiente], [0, 3000]);

  // --- Dos pagos simultáneos al mismo entregador: solo uno se registra
  const both = await Promise.all([0, 1].map(() => fetch(base + '/api/pagos-delivery/pagar', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: auth.admin },
    body: JSON.stringify({ clave: randomUUID(), fk_identregador_delivery: beto, inicio: today, fin: today, fk_idforma_pago: cash }) })));
  assert.deepEqual(both.map(r => r.status).sort(), [200, 409]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pago_delivery WHERE fk_identregador_delivery=$1 AND estado='pagado'", [beto])).rows[0].n, 1);

  // --- Anular el pago de Ana: el gasto se anula (vuelve a caja) y los pedidos quedan pendientes
  await post(`/api/pagos-delivery/${pago.idpago_delivery}/anular`, { motivo: '' }, { status: 400 });
  const annulled = (await post(`/api/pagos-delivery/${pago.idpago_delivery}/anular`, { motivo: 'Pagado dos veces' })).pago;
  assert.equal(annulled.estado, 'anulado');
  assert.equal((await pool.query('SELECT estado FROM gasto WHERE idgasto=$1', [pago.fk_idgasto])).rows[0].estado, 'anulado');
  const reversal = (await pool.query('SELECT tipo_movimiento FROM caja_item WHERE fk_idgasto=$1 AND es_reversion', [pago.fk_idgasto])).rows;
  assert.deepEqual(reversal.map(r => r.tipo_movimiento), ['ingreso'], 'La plata vuelve a la caja');
  await post(`/api/pagos-delivery/${pago.idpago_delivery}/anular`, { motivo: 'Otra vez' }, { status: 409 });
  data = await call(path());
  assert.deepEqual([courier(data, ana).pendiente, courier(data, ana).pagado], [3000, 0]);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auditoria WHERE accion='PAGO_DELIVERY_ANULADO'")).rows[0].n, 1);
  // Tras anular, se puede volver a pagar.
  assert.equal((await post('/api/pagos-delivery/pagar', payBody)).pago.total, 3000);

  // --- "Ya pagado" sin caja: delivery pagado fuera del sistema. No mueve la caja ni crea gasto, exige observación.
  const o6 = await order(beto);
  await charge(o6);
  const pendingBefore = (await call('/api/cajas')).delivery_pendiente;
  const egresosSinCajaAntes = Number((await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(a => a.fk_idforma_pago === cash).total_egresos);
  const noCashBody = { fk_identregador_delivery: beto, inicio: today, fin: today, sin_caja: true };
  assert.match((await post('/api/pagos-delivery/pagar', { ...noCashBody, observacion: '  ' }, { status: 400 })).error, /observación es obligatori/i);
  const noCash = (await post('/api/pagos-delivery/pagar', { ...noCashBody, observacion: 'Pagado en efectivo el viernes, antes del sistema', total: 1500 })).pago;
  assert.deepEqual([noCash.sin_caja, noCash.fk_idgasto, noCash.fk_idforma_pago, noCash.forma_pago, noCash.total, noCash.pedidos.length], [true, null, null, 'Sin caja', 1500, 1]);
  const egresosSinCajaDespues = Number((await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(a => a.fk_idforma_pago === cash).total_egresos);
  assert.equal(egresosSinCajaDespues, egresosSinCajaAntes, 'Ya pagado no mueve la caja');
  assert.deepEqual((await call('/api/cajas')).delivery_pendiente, { pedidos: pendingBefore.pedidos - 1, total: pendingBefore.total - 1500 }, 'Baja el aviso de caja');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM auditoria WHERE accion='PAGO_DELIVERY_SIN_CAJA' AND id_entidad=$1", [noCash.idpago_delivery])).rows[0].n, 1);
  data = await call(path());
  assert.equal(courier(data, beto).pendiente, 0);
  const listed = data.pagos.find(p => p.idpago_delivery === noCash.idpago_delivery);
  assert.deepEqual([listed.sin_caja, listed.forma_pago, listed.observacion], [true, 'Sin caja', 'Pagado en efectivo el viernes, antes del sistema']);
  await assert.rejects(pool.query('UPDATE pago_delivery SET observacion=NULL WHERE idpago_delivery=$1', [noCash.idpago_delivery]), /pago_delivery_origen_valido/, 'Sin caja exige observación también en la base');
  const noCashTicket = await call(`/api/pagos-delivery/${noCash.idpago_delivery}/ticket.pdf`, { raw: true });
  assert.equal(Buffer.from(await noCashTicket.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  // Anularlo libera el pedido y tampoco toca la caja.
  await post(`/api/pagos-delivery/${noCash.idpago_delivery}/anular`, { motivo: 'Era de otro entregador' });
  assert.equal(Number((await call(`/api/cajas/${box.idcaja_gral}`)).arqueos.find(a => a.fk_idforma_pago === cash).total_egresos), egresosSinCajaAntes);
  assert.equal(courier(await call(path()), beto).pendiente, 1500);

  // --- Reportes y comprobante
  const ticket = await call(`/api/pagos-delivery/${pago.idpago_delivery}/ticket.pdf`, { raw: true });
  assert.equal(Buffer.from(await ticket.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const pdf = await call(`/api/pagos-delivery/reporte.pdf?inicio=${today}&fin=${today}`, { raw: true });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await call(`/api/pagos-delivery/reporte.xlsx?inicio=${today}&fin=${today}`, { raw: true });
  assert.equal(Buffer.from(await xlsx.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  const emptyPdf = await call('/api/pagos-delivery/reporte.pdf?inicio=2000-01-01&fin=2000-01-02', { raw: true });
  assert.equal(emptyPdf.status, 200);
  const options = await call('/api/pagos-delivery/opciones');
  assert.ok(options.caja_abierta && [ana, beto].every(idValue => options.entregadores.some(e => e.id === idValue)) && options.formas.length);

  console.log('PASS: pagos a delivery (pendiente por entregador, pago desde caja, sin pagos dobles, anulación, sin entregador, aviso en caja, permisos y reportes).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
