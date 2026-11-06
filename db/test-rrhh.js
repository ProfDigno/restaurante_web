// Verificación HTTP del módulo RR.HH. (Personal y Vales con caja) en un esquema temporal aislado de los datos reales.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { pool } from '../src/config/database.js';

const schema = `test_rrhh_${Date.now()}`;
assert.match(schema, /^test_rrhh_[0-9]+$/);
const adminDb = new pg.Client(pool.options);
await adminDb.connect();
let server;
try {
  await adminDb.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
    // La migración debe poder correr sobre una base ya instalada sin errores (idempotente).
    await setup.query(await readFile(new URL('./migrations/20261107_rrhh.sql', import.meta.url), 'utf8'));
    await setup.query('COMMIT');
  } finally { setup.release(); }
  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario,r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','encargado','mozo')")).rows;
  const cookie = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession(user)}`]));
  async function call(path, { method = 'GET', body, as = 'admin', status = 200, raw = false } = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie[as] }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (raw) { assert.equal(response.status, status, `${method} ${path}`); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const post = (path, body, opts = {}) => call(path, { method: 'POST', body: { ...body, clave: randomUUID() }, ...opts });
  const put = (path, body, opts = {}) => call(path, { method: 'PUT', body: { ...body, clave: randomUUID() }, ...opts });

  // Permisos: solo admin ve RR.HH.
  const me = await call('/api/auth/me');
  assert.deepEqual(me.menu.find(s => s.id === 'rrhh').items.map(i => i.id), ['personal', 'vales']);
  for (const rol of ['encargado', 'mozo']) {
    await call('/api/personal', { as: rol, status: 403 });
    await call('/api/vales', { as: rol, status: 403 });
  }

  // Personal: alta, validaciones y edición.
  const persona = { nombre_completo: 'Ana Prueba', documento: '123', telefono: '0981', cargo: 'Cocinera', direccion: 'Centro', fecha_ingreso: '2026-10-01', tipo_pago: 'SEMANAL', monto_pago: '600000', limite_monto_vale: '200000', observacion: '', activo: true };
  const ana = (await post('/api/personal', persona)).item;
  assert.equal(ana.tipo_pago, 'SEMANAL');
  assert.equal(Number(ana.monto_pago), 600000);
  assert.equal(ana.fecha_ingreso, '2026-10-01');
  await post('/api/personal', { ...persona, tipo_pago: 'ANUAL' }, { status: 400 });
  await post('/api/personal', { ...persona, nombre_completo: 'Otra', documento: '123' }, { status: 409 });
  const sinLimite = (await post('/api/personal', { ...persona, nombre_completo: 'Beto Sin Límite', documento: '', tipo_pago: 'DIARIO', monto_pago: '80000', limite_monto_vale: '0' })).item;
  assert.equal((await put(`/api/personal/${ana.idpersonal}`, { ...persona, tipo_pago: 'QUINCENAL' })).item.tipo_pago, 'QUINCENAL');
  assert.ok((await call('/api/personal?search=coci')).items.some(p => p.idpersonal === ana.idpersonal));

  // Vales: sin caja abierta no se registran.
  const opciones = await call('/api/vales/opciones');
  const efectivo = opciones.formas.find(f => f.es_default) || opciones.formas[0];
  assert.equal(opciones.caja_abierta, false);
  const valeBody = { fk_idpersonal: ana.idpersonal, fk_idforma_pago: efectivo.idforma_pago, monto_vale: 50000, descripcion: '' };
  assert.match((await post('/api/vales', valeBody, { status: 400 })).error, /Abrí una caja/);

  const caja = await post('/api/cajas/abrir', { monto_inicial: 100000 });
  const v1 = (await post('/api/vales', valeBody)).item;
  assert.equal(v1.estado, 'pagado');
  assert.equal(v1.descripcion, 'Vale a Ana Prueba');
  // Refleja en caja: egreso por el monto del vale.
  const egreso = (await pool.query('SELECT tipo_movimiento,monto_vale,es_reversion FROM caja_item WHERE fk_idvale=$1', [v1.idvale])).rows;
  assert.deepEqual(egreso.map(r => [r.tipo_movimiento, Number(r.monto_vale), r.es_reversion]), [['egreso', 50000, false]]);
  let detalle = await call(`/api/cajas/${caja.idcaja_gral}`);
  assert.equal(Number(detalle.caja.monto_esperado), 50000);
  assert.ok(detalle.movimientos.some(m => m.origen === 'vale' && Number(m.monto) === 50000));

  // Límite por vale y límite 0 = sin límite.
  assert.match((await post('/api/vales', { ...valeBody, monto_vale: 250000 }, { status: 400 })).error, /límite/);
  const v2 = (await post('/api/vales', { ...valeBody, fk_idpersonal: sinLimite.idpersonal, monto_vale: 900000 })).item;
  assert.equal(v2.estado, 'pagado');

  // Listado con filtros y totales.
  const lista = await call(`/api/vales?personal=${ana.idpersonal}`);
  assert.equal(lista.total, 1);
  assert.equal(lista.resumen.monto_pagado, 50000);
  assert.equal(Number((await call('/api/personal?search=Ana')).items[0].vales_mes), 50000);

  // Anular: motivo obligatorio, reversión en caja y no se anula dos veces.
  await post(`/api/vales/${v1.idvale}/anular`, { motivo: '' }, { status: 400 });
  const anulado = (await post(`/api/vales/${v1.idvale}/anular`, { motivo: 'Cargado por error' })).item;
  assert.equal(anulado.estado, 'anulado');
  const movimientos = (await pool.query('SELECT tipo_movimiento,es_reversion FROM caja_item WHERE fk_idvale=$1 ORDER BY idcaja_item', [v1.idvale])).rows;
  assert.deepEqual(movimientos.map(r => [r.tipo_movimiento, r.es_reversion]), [['egreso', false], ['ingreso', true]]);
  detalle = await call(`/api/cajas/${caja.idcaja_gral}`);
  assert.equal(Number(detalle.caja.monto_esperado), 100000 - 900000);
  await post(`/api/vales/${v1.idvale}/anular`, { motivo: 'Otra vez' }, { status: 409 });
  const resumen = (await call('/api/vales')).resumen;
  assert.deepEqual([resumen.pagados, resumen.monto_pagado, resumen.anulados, resumen.monto_anulado], [1, 900000, 1, 50000]);

  // Persona inactiva: no recibe vales nuevos, pero su vale anterior se puede anular.
  await put(`/api/personal/${sinLimite.idpersonal}`, { ...persona, nombre_completo: 'Beto Sin Límite', documento: '', tipo_pago: 'DIARIO', monto_pago: '80000', limite_monto_vale: '0', activo: false });
  await post('/api/vales', { ...valeBody, fk_idpersonal: sinLimite.idpersonal, monto_vale: 1000 }, { status: 400 });
  assert.equal((await post(`/api/vales/${v2.idvale}/anular`, { motivo: 'Baja' })).item.estado, 'anulado');

  // Comprobante PDF.
  const pdf = await call(`/api/vales/${v1.idvale}/ticket.pdf`, { raw: true });
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);
  await call('/api/vales/999999/ticket.pdf', { status: 404 });

  console.log('RR.HH. verificado: personal, vales, caja, anulación, límites y permisos');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await adminDb.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminDb.end();
}
