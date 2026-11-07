import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Cargos del personal (RR.HH.): sin duplicados (mayúsculas y espacios), cargos inactivos, uso en Personal,
// Vales y Análisis de vales, permisos, y migración de los cargos escritos a mano.
const schema = `test_cargos_${Date.now()}`;
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
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const post = (path, body, opts = {}) => call(path, { method: 'POST', body: { ...body, clave: randomUUID() }, ...opts });
  const put = (path, body, opts = {}) => call(path, { method: 'PUT', body: { ...body, clave: randomUUID() }, ...opts });

  // --- Permisos: como Personal, solo admin
  await call('/api/cargos-personal', { role: null, status: 401 });
  for (const role of ['encargado', 'mozo']) {
    await call('/api/cargos-personal', { role, status: 403 });
    await post('/api/cargos-personal', { nombre: 'X', activo: true }, { role, status: 403 });
  }
  assert.ok((await call('/api/auth/me')).menu.find(s => s.id === 'rrhh').items.some(i => i.id === 'cargos'));

  // --- Sin duplicados: mayúsculas y espacios no cuentan
  const cocinera = (await post('/api/cargos-personal', { nombre: '  Cocinera   de   turno ', activo: true })).item;
  assert.equal(cocinera.nombre, 'Cocinera de turno', 'Se guarda sin espacios sobrantes');
  for (const twin of ['COCINERA DE TURNO', 'cocinera de turno', ' Cocinera  de turno']) {
    assert.match((await post('/api/cargos-personal', { nombre: twin, activo: true }, { status: 409 })).error, /Ya existe el cargo "Cocinera de turno"/);
  }
  await assert.rejects(pool.query("INSERT INTO cargo_personal(nombre) VALUES('COCINERA DE TURNO')"), /cargo_personal_nombre_unico/, 'La base también lo impide');
  await assert.rejects(pool.query("INSERT INTO cargo_personal(nombre) VALUES(' Mozo')"), /cargo_personal_nombre_limpio/);
  await post('/api/cargos-personal', { nombre: '   ', activo: true }, { status: 400 });
  await post('/api/cargos-personal', { nombre: 'x'.repeat(81), activo: true }, { status: 400 });
  const mozo = (await post('/api/cargos-personal', { nombre: 'Mozo', activo: true })).item;
  // Renombrar a un nombre que ya existe también se rechaza; cambiar solo mayúsculas del propio sí se permite.
  await put(`/api/cargos-personal/${mozo.idcargo_personal}`, { nombre: 'cocinera de turno', activo: true }, { status: 409 });
  assert.equal((await put(`/api/cargos-personal/${mozo.idcargo_personal}`, { nombre: 'MOZO', activo: true })).item.nombre, 'MOZO');
  await put(`/api/cargos-personal/${mozo.idcargo_personal}`, { nombre: 'Mozo', activo: true });

  // --- Personal usa el catálogo
  const persona = (nombre, cargo) => ({ nombre_completo: nombre, documento: '', telefono: '', fk_idcargo_personal: cargo, direccion: '', fecha_ingreso: '', tipo_pago: 'MENSUAL', monto_pago: '1000000', limite_monto_vale: '0', observacion: '', activo: true });
  const ana = (await post('/api/personal', persona('Ana', cocinera.idcargo_personal))).item;
  assert.equal(ana.cargo, 'Cocinera de turno');
  const beto = (await post('/api/personal', persona('Beto', null))).item;
  assert.equal(beto.cargo, null);
  await post('/api/personal', persona('Caro', 999999), { status: 400 });
  assert.ok((await call('/api/personal?search=turno')).items.some(p => p.idpersonal === ana.idpersonal), 'Busca por nombre del cargo');
  const list = await call('/api/cargos-personal');
  assert.deepEqual(list.items.map(c => [c.nombre, c.personas]), [['Cocinera de turno', 1], ['Mozo', 0]]);
  assert.ok((await call('/api/cargos-personal/opciones', { role: 'admin' })).items.length === 2);

  // Renombrar el cargo se ve en la persona.
  await put(`/api/cargos-personal/${cocinera.idcargo_personal}`, { nombre: 'Cocinera', activo: true });
  assert.equal((await call('/api/personal?search=Ana')).items[0].cargo, 'Cocinera');

  // Cargo inactivo: no se asigna a otra persona, pero quien ya lo tenía lo conserva al editar.
  await put(`/api/cargos-personal/${cocinera.idcargo_personal}`, { nombre: 'Cocinera', activo: false });
  assert.match((await put(`/api/personal/${beto.idpersonal}`, persona('Beto', cocinera.idcargo_personal), { status: 400 })).error, /inactivo/);
  assert.equal((await put(`/api/personal/${ana.idpersonal}`, { ...persona('Ana', cocinera.idcargo_personal), telefono: '0981' })).item.cargo, 'Cocinera');
  assert.equal((await put(`/api/personal/${ana.idpersonal}`, persona('Ana', mozo.idcargo_personal))).item.cargo, 'Mozo');
  await put(`/api/cargos-personal/${cocinera.idcargo_personal}`, { nombre: 'Cocinera', activo: true });

  // --- Vales y Análisis de vales muestran el cargo del catálogo
  await post('/api/cajas/abrir', { monto_inicial: 100000 });
  const forma = (await call('/api/vales/opciones')).formas[0];
  const vale = (await post('/api/vales', { fk_idpersonal: ana.idpersonal, fk_idforma_pago: forma.idforma_pago, monto_vale: 10000, descripcion: '' })).item;
  assert.equal(vale.personal_cargo, 'Mozo');
  assert.equal((await call('/api/vales/opciones')).personal.find(p => p.idpersonal === ana.idpersonal).cargo, 'Mozo');
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const kpi = await call(`/api/kpi-vales?inicio=${today}&fin=${today}`);
  assert.deepEqual(kpi.cargos.map(c => c.nombre), ['Mozo']);
  assert.equal(kpi.personas[0].cargo, 'Mozo');

  // --- Migración: cargos escritos a mano con duplicados pasan al catálogo unificados
  const legacy = `test_cargos_legacy_${Date.now()}`;
  await admin.query(`CREATE SCHEMA "${legacy}"`);
  const old = new pg.Client(pool.options);
  await old.connect();
  await old.query(`SET search_path TO "${legacy}"`);
  try {
    await old.query(`CREATE TABLE personal (idpersonal serial PRIMARY KEY, nombre_completo text NOT NULL, cargo varchar(80), activo boolean NOT NULL DEFAULT true)`);
    await old.query(`INSERT INTO personal(nombre_completo, cargo) VALUES
      ('A','Cocinera'),('B','COCINERA '),('C',' cocinera'),('D','Cocinera'),('E','Mozo   de salón'),('F','mozo de salón'),('G',NULL),('H','  ')`);
    const sql = await readFile(new URL('./migrations/20261108_cargo_personal.sql', import.meta.url), 'utf8');
    await old.query(sql);
    const cargos = (await old.query('SELECT nombre FROM cargo_personal ORDER BY orden')).rows.map(r => r.nombre);
    assert.deepEqual(cargos, ['Cocinera', 'Mozo de salón'], 'Unifica duplicados con la grafía más usada');
    const people = Object.fromEntries((await old.query('SELECT p.nombre_completo, c.nombre FROM personal p LEFT JOIN cargo_personal c ON c.idcargo_personal=p.fk_idcargo_personal')).rows.map(r => [r.nombre_completo, r.nombre]));
    assert.deepEqual(people, { A: 'Cocinera', B: 'Cocinera', C: 'Cocinera', D: 'Cocinera', E: 'Mozo de salón', F: 'Mozo de salón', G: null, H: null });
    assert.equal((await old.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='personal' AND column_name='cargo'")).rows[0].n, 0, 'La columna de texto se elimina');
    await old.query(sql);
    assert.equal((await old.query('SELECT count(*)::int AS n FROM cargo_personal')).rows[0].n, 2, 'Correrla de nuevo no cambia nada');
  } finally {
    await old.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${legacy}" CASCADE`);
  }

  console.log('PASS: cargos del personal (sin duplicados, normalización, inactivos, Personal, Vales, análisis, permisos y migración).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
