import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Observación por producto de cocina ("Obs:") con precio por unidad: validaciones, total del pedido,
// edición, comanda, ticket, factura y rentabilidad.
const schema = `test_observacion_${Date.now()}`;
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
  const { order } = await import('../src/services/pedidos.js');
  const { lineasDesdePedido } = await import('../src/services/factura.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, text = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: auth[role] }, body: body ? JSON.stringify(body) : undefined });
    if (text) { assert.equal(response.status, status); return response.text(); }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };

  const clientId = (await pool.query("SELECT idcliente FROM cliente WHERE ruc='20123456789'")).rows[0].idcliente;
  const [plato] = (await pool.query("SELECT idproducto_menu AS id, precio_venta::int AS precio, es_cocina FROM producto_menu WHERE nombre='Plato de la casa'")).rows;
  const [gaseosa] = (await pool.query("SELECT idproducto_menu AS id, precio_venta::int AS precio, es_cocina FROM producto_menu WHERE nombre='Gaseosa'")).rows;
  assert.ok(plato.es_cocina && !gaseosa.es_cocina);
  await pool.query('UPDATE producto_menu SET stock_actual=100 WHERE idproducto_menu=ANY($1::int[])', [[plato.id, gaseosa.id]]);
  const body = (detalles, extra = {}) => ({ clave: randomUUID(), tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, detalles, ...extra });

  // --- El catálogo informa si el producto es de cocina (habilita OBS en pantalla)
  const catalog = await call('/api/pedidos/catalogo?pageSize=50');
  assert.equal(catalog.items.find(p => p.idproducto_menu === plato.id).es_cocina, true);

  // --- Validaciones
  const bad = async (line, pattern) => assert.match((await call('/api/pedidos', { method: 'POST', body: body([line]), status: 400 })).error, pattern);
  await bad({ fk_idproducto_menu: gaseosa.id, cantidad: 1, observaciones: 'con hielo' }, /solo los productos de cocina admiten observación/);
  await bad({ fk_idproducto_menu: plato.id, cantidad: 1, observaciones: '', precio_observacion: 1000 }, /Escribí la observación/);
  await bad({ fk_idproducto_menu: plato.id, cantidad: 1, observaciones: 'x'.repeat(201) }, /hasta 200 caracteres/);
  await bad({ fk_idproducto_menu: plato.id, cantidad: 1, observaciones: 'extra', precio_observacion: -5 }, /entero válido/);
  // Sin observación, la gaseosa (no es de cocina) se guarda normal.
  await call('/api/pedidos', { method: 'POST', body: body([{ fk_idproducto_menu: gaseosa.id, cantidad: 1, observaciones: '  ', precio_observacion: 0 }]) });

  // --- Guardar con observación y precio por unidad
  const created = (await call('/api/pedidos', { method: 'POST', body: body([
    { fk_idproducto_menu: plato.id, cantidad: 2, observaciones: '  sin   sal,  extra salsa ', precio_observacion: 1500 },
    { fk_idproducto_menu: plato.id, cantidad: 1 },
    { fk_idproducto_menu: gaseosa.id, cantidad: 1 }
  ]) })).pedido;
  const withObs = created.detalles.find(d => d.observaciones);
  assert.equal(withObs.observaciones, 'sin sal, extra salsa', 'Se guarda sin espacios sobrantes');
  assert.equal(Number(withObs.precio_observacion), 1500);
  assert.equal(created.detalles.filter(d => d.fk_idproducto_menu === plato.id).length, 2, 'Mismo producto con y sin observación en líneas aparte');
  assert.equal(Number(created.monto_total), 3 * plato.precio + 2 * 1500 + gaseosa.precio, 'La observación suma cantidad × precio');

  // --- Comanda: muestra la observación
  const comanda = (await call('/api/comandas', { role: 'mozo' })).items.find(item => item.idpedido === created.idpedido);
  assert.ok(comanda.detalles.some(line => line.observaciones === 'sin sal, extra salsa'));

  // --- Ticket del pedido
  const ticket = await call(`/api/pedidos/${created.idpedido}/ticket`, { text: true });
  assert.match(ticket, /Obs: sin sal, extra salsa \(Gs\. 1\.500 c\/u\)/);
  const pdf = await fetch(`${base}/api/pedidos/${created.idpedido}/ticket.pdf`, { headers: { Cookie: auth.admin } });
  assert.equal(pdf.status, 200);

  // --- Factura: la observación con precio va como línea adicional y el total coincide
  const lines = lineasDesdePedido(await order(pool, created.idpedido));
  const obsLine = lines.find(line => line.codigo === `OBS-${withObs.iddetalle_pedido}`);
  assert.deepEqual([obsLine.cantidad, obsLine.precio_unitario], [2, 1500]);
  assert.match(obsLine.descripcion, /Adicional: sin sal, extra salsa/);
  assert.equal(lines.reduce((sum, line) => sum + line.cantidad * line.precio_unitario, 0), Number(created.monto_total));

  // --- Editar: cambiar texto y precio; una línea sin los campos conserva lo que tenía
  const full = await call(`/api/pedidos/${created.idpedido}`);
  const keep = full.detalles.map(({ iddetalle_pedido, fk_idproducto_menu, cantidad }) => ({ iddetalle_pedido, fk_idproducto_menu, cantidad }));
  const edited = (await call(`/api/pedidos/${created.idpedido}`, { method: 'PUT', body: { ...body(keep), version_web: full.version_web } })).pedido;
  assert.equal(edited.detalles.find(d => d.iddetalle_pedido === withObs.iddetalle_pedido).observaciones, 'sin sal, extra salsa', 'Sin campos, se conserva');
  const changed = edited.detalles.map(d => d.iddetalle_pedido === withObs.iddetalle_pedido
    ? { iddetalle_pedido: d.iddetalle_pedido, fk_idproducto_menu: d.fk_idproducto_menu, cantidad: 2, observaciones: 'bien cocida', precio_observacion: 0 }
    : { iddetalle_pedido: d.iddetalle_pedido, fk_idproducto_menu: d.fk_idproducto_menu, cantidad: d.cantidad, observaciones: d.observaciones, precio_observacion: d.precio_observacion });
  const recalculated = (await call(`/api/pedidos/${created.idpedido}`, { method: 'PUT', body: { ...body(changed), version_web: edited.version_web } })).pedido;
  const line = recalculated.detalles.find(d => d.iddetalle_pedido === withObs.iddetalle_pedido);
  assert.deepEqual([line.observaciones, Number(line.precio_observacion)], ['bien cocida', 0]);
  assert.equal(Number(recalculated.monto_total), 3 * plato.precio + gaseosa.precio, 'Precio 0: no suma');
  assert.ok(!lineasDesdePedido(await order(pool, created.idpedido)).some(l => l.codigo.startsWith('OBS-')), 'Sin precio no hay línea en la factura');
  // Una línea existente que no es de cocina tampoco acepta observación al editar.
  const gasLine = recalculated.detalles.find(d => d.fk_idproducto_menu === gaseosa.id);
  const withGasObs = recalculated.detalles.map(d => ({ iddetalle_pedido: d.iddetalle_pedido, fk_idproducto_menu: d.fk_idproducto_menu, cantidad: d.cantidad,
    observaciones: d.iddetalle_pedido === gasLine.iddetalle_pedido ? 'con limón' : d.observaciones, precio_observacion: d.precio_observacion }));
  assert.match((await call(`/api/pedidos/${created.idpedido}`, { method: 'PUT', body: { ...body(withGasObs), version_web: recalculated.version_web }, status: 400 })).error, /solo los productos de cocina/);

  // --- Rentabilidad: el precio de la observación suma a la venta
  const priced = (await call('/api/pedidos', { method: 'POST', body: body([{ fk_idproducto_menu: plato.id, cantidad: 3, observaciones: 'extra queso', precio_observacion: 2000 }]) })).pedido;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const kpi = await call(`/api/kpi-rentabilidad?inicio=${today}&fin=${today}`);
  const platoKpi = kpi.productos.find(p => p.id === plato.id);
  assert.equal(platoKpi.venta, 3 * plato.precio + 3 * plato.precio + 3 * 2000, 'Venta del plato incluye 3 × 2.000 de la observación');
  assert.ok(priced.idpedido);

  console.log('PASS: observación de producto (cocina, validaciones, precio por unidad, total, edición, comanda, ticket, factura y rentabilidad).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
