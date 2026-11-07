import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Análisis de vales (RR.HH.): totales, anulados aparte, por persona/cargo/forma de pago, % del sueldo del período,
// período anterior, filtro por persona, permisos, PDF y Excel.
const schema = `test_kpi_vales_${Date.now()}`;
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
  const { sueldoDelPeriodo } = await import('../src/services/kpi-vales.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','encargado','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, raw = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw) { assert.equal(response.status, status); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const post = (path, body, opts = {}) => call(path, { method: 'POST', body: { ...body, clave: randomUUID() }, ...opts });

  // Sueldo del período según el tipo de pago (días corridos).
  assert.equal(sueldoDelPeriodo(3000000, 'MENSUAL', 30), 3000000);
  assert.equal(sueldoDelPeriodo(700000, 'SEMANAL', 14), 1400000);
  assert.equal(sueldoDelPeriodo(1500000, 'QUINCENAL', 30), 3000000);
  assert.equal(sueldoDelPeriodo(100000, 'DIARIO', 3), 300000);
  assert.equal(sueldoDelPeriodo(0, 'MENSUAL', 30), 0);

  // --- Datos: tres personas, caja abierta y vales (uno anulado)
  const cargoIds = {};
  for (const nombre of ['Cocinera', 'Mozo']) cargoIds[nombre] = (await post('/api/cargos-personal', { nombre, activo: true })).item.idcargo_personal;
  const persona = (nombre, cargo, tipo_pago, monto_pago) => post('/api/personal', { nombre_completo: nombre, documento: '', telefono: '', fk_idcargo_personal: cargoIds[cargo], direccion: '', fecha_ingreso: '', tipo_pago, monto_pago: String(monto_pago), limite_monto_vale: '0', observacion: '', activo: true }).then(r => r.item);
  const ana = await persona('Ana Cocina', 'Cocinera', 'MENSUAL', 3000000);
  const beto = await persona('Beto Salón', 'Mozo', 'DIARIO', 100000);
  const caro = await persona('Caro Sin Sueldo', 'Cocinera', 'MENSUAL', 0);
  const formas = (await call('/api/vales/opciones')).formas;
  const efectivo = formas.find(f => f.es_default) || formas[0];
  await post('/api/cajas/abrir', { monto_inicial: 1000000 });
  const vale = async (who, monto) => (await post('/api/vales', { fk_idpersonal: who.idpersonal, fk_idforma_pago: efectivo.idforma_pago, monto_vale: monto, descripcion: '' })).item;
  await vale(ana, 200000); await vale(ana, 100000); await vale(beto, 50000); await vale(caro, 30000);
  const anulado = await vale(beto, 40000);
  await post(`/api/vales/${anulado.idvale}/anular`, { motivo: 'Error de carga' });

  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const path = (extra = '') => `/api/kpi-vales?inicio=${start}&fin=${today}${extra}`;

  // --- Permisos y validación: como Vales, solo admin
  await call(path(), { role: null, status: 401 });
  await call(path(), { role: 'encargado', status: 403 });
  await call(path(), { role: 'mozo', status: 403 });
  await call(`/api/kpi-vales?inicio=${today}&fin=${start}`, { status: 400 });
  await call(path('&personal=abc'), { status: 400 });
  assert.ok((await call('/api/auth/me')).menu.find(s => s.id === 'rrhh').items.some(i => i.id === 'kpi-vales'));

  // --- Cálculo (30 días)
  const data = await call(path());
  const s = data.resumen;
  assert.equal(data.dias_periodo, 30);
  assert.deepEqual([s.cantidad, s.monto, s.personas, s.promedio], [4, 380000, 3, 95000]);
  assert.deepEqual(s.anulados, { cantidad: 1, monto: 40000 });
  assert.equal(s.sueldo_periodo, 3000000 + 3000000, 'Ana mensual 3.000.000 + Beto 100.000 × 30 días; Caro sin sueldo no suma');
  assert.ok(Math.abs(s.pct_sueldo - (350000 / 6000000 * 100)) < 1e-9);
  const byName = Object.fromEntries(data.personas.map(p => [p.nombre, p]));
  assert.deepEqual([byName['Ana Cocina'].cantidad, byName['Ana Cocina'].monto, byName['Ana Cocina'].mayor, byName['Ana Cocina'].promedio], [2, 300000, 200000, 150000]);
  assert.ok(Math.abs(byName['Ana Cocina'].pct_sueldo - 10) < 1e-9);
  assert.equal(byName['Beto Salón'].monto, 50000, 'El vale anulado no suma');
  assert.equal(byName['Caro Sin Sueldo'].pct_sueldo, null);
  assert.deepEqual(data.personas.map(p => p.nombre), ['Ana Cocina', 'Beto Salón', 'Caro Sin Sueldo'], 'Ordenado por importe');
  assert.deepEqual(data.cargos.map(c => [c.nombre, c.cantidad, c.monto]), [['Cocinera', 3, 330000], ['Mozo', 1, 50000]]);
  assert.deepEqual(data.formas.map(f => [f.cantidad, f.monto]), [[4, 380000]]);
  assert.equal(data.dias.length, 30);
  assert.equal(data.dias.at(-1).monto, 380000);
  assert.equal(data.semana.reduce((sum, d) => sum + d.monto, 0), 380000);
  assert.ok(!('vales' in data), 'La pantalla no recibe el detalle');

  // Filtro por persona
  const onlyAna = await call(path(`&personal=${ana.idpersonal}`));
  assert.deepEqual([onlyAna.resumen.cantidad, onlyAna.resumen.monto, onlyAna.personas.length], [2, 300000, 1]);
  assert.equal(onlyAna.filtro, 'Personal: Ana Cocina');

  // Período anterior: un vale de Ana se pasa 40 días atrás.
  await pool.query("UPDATE vale SET fecha_vale=fecha_vale-INTERVAL '40 days' WHERE fk_idpersonal=$1 AND monto_vale=100000", [ana.idpersonal]);
  const moved = await call(path());
  assert.deepEqual([moved.resumen.monto, moved.resumen.anterior.monto, moved.resumen.anterior.cantidad], [280000, 100000, 1]);

  // Período vacío
  const empty = await call('/api/kpi-vales?inicio=2000-01-01&fin=2000-01-03');
  assert.deepEqual([empty.resumen.cantidad, empty.resumen.monto, empty.resumen.pct_sueldo, empty.personas.length], [0, 0, null, 0]);

  // --- Opciones, PDF y Excel
  assert.ok((await call('/api/kpi-vales/opciones')).personal.some(p => p.id === caro.idpersonal));
  const pdf = await call(`/api/kpi-vales/reporte.pdf?inicio=${start}&fin=${today}`, { raw: true });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const emptyPdf = await call('/api/kpi-vales/reporte.pdf?inicio=2000-01-01&fin=2000-01-03', { raw: true });
  assert.equal(Buffer.from(await emptyPdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await call(`/api/kpi-vales/reporte.xlsx?inicio=${start}&fin=${today}`, { raw: true });
  assert.match(xlsx.headers.get('content-disposition'), /analisis-vales-/);
  const zip = await JSZip.loadAsync(Buffer.from(await xlsx.arrayBuffer()));
  const workbook = await zip.file('xl/workbook.xml').async('string');
  for (const sheet of ['Resumen', 'Personas', 'Vales']) assert.match(workbook, new RegExp(`name="${sheet}"`));
  assert.ok(zip.file('xl/charts/chart1.xml') && zip.file('xl/charts/chart2.xml'), 'El Excel trae los gráficos');
  const strings = await zip.file('xl/sharedStrings.xml').async('string');
  assert.match(strings, /Error de carga/, 'El detalle incluye el vale anulado con su motivo');
  const emptyXlsx = await call('/api/kpi-vales/reporte.xlsx?inicio=2000-01-01&fin=2000-01-03', { raw: true });
  assert.ok((await JSZip.loadAsync(Buffer.from(await emptyXlsx.arrayBuffer()))).file('xl/workbook.xml'));
  await call(`/api/kpi-vales/reporte.xlsx?inicio=${start}&fin=${today}`, { role: 'encargado', status: 403 });

  console.log('PASS: análisis de vales (totales, anulados, personas, cargos, % del sueldo, período anterior, filtro, permisos, PDF y Excel).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
