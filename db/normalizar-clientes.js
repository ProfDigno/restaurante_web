import 'dotenv/config';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';

// Normaliza los clientes de la base actual (DB_NAME):
//  1. Nombre, razón social, dirección y notas en MAYÚSCULAS (el email no se toca).
//  2. Cada RUC válido se consulta en turuc.com.py (la misma API de /api/clientes/consulta-ruc):
//     si existe, el nombre y la razón social pasan a ser la razón social oficial, y el RUC queda
//     completo con su dígito verificador (si ningún otro cliente ya lo tiene).
//
//   node db/normalizar-clientes.js            aplica los cambios
//   node db/normalizar-clientes.js --dry-run  solo informa
// Informe con el antes y el después de cada cliente: ../clientes-ruc-report.json

const dryRun = process.argv.includes('--dry-run');
const REPORT = '../clientes-ruc-report.json';
const DELAY_MS = 250;
const db = new pg.Client({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const up = v => (v == null ? v : String(v).trim().replace(/\s+/g, ' ').toUpperCase());

async function consultar(ruc) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(`https://turuc.com.py/api/contribuyente/${encodeURIComponent(ruc)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.data) return { ok: true, data: body.data };
      if (res.status === 404 || (res.ok && !body.data)) return { ok: false, motivo: body.message || 'No encontrado' };
      if (intento === 3) return { ok: false, motivo: `HTTP ${res.status}` };
    } catch (e) { if (intento === 3) return { ok: false, motivo: e.message }; }
    await sleep(1000 * intento);
  }
}

await db.connect();
const report = { base: process.env.DB_NAME, modo: dryRun ? 'dry-run' : 'apply', generado: new Date().toISOString(), mayusculas: 0, ruc: { consultados: 0, actualizados: 0, ruc_completado: 0, no_encontrados: [], invalidos: [], conflictos: [] }, cambios: [] };
try {
  await db.query('BEGIN');
  const upper = await db.query(`UPDATE cliente SET nombre_completo=upper(btrim(nombre_completo)), razon_social=upper(btrim(razon_social)), direccion=upper(btrim(direccion)), notas=upper(btrim(notas))
    WHERE nombre_completo IS DISTINCT FROM upper(btrim(nombre_completo)) OR razon_social IS DISTINCT FROM upper(btrim(razon_social)) OR direccion IS DISTINCT FROM upper(btrim(direccion)) OR notas IS DISTINCT FROM upper(btrim(notas))`);
  report.mayusculas = upper.rowCount;
  console.log(`Mayúsculas: ${upper.rowCount} clientes`);

  const { rows } = await db.query('SELECT idcliente, nombre_completo, razon_social, ruc FROM cliente WHERE ruc IS NOT NULL ORDER BY idcliente');
  for (const c of rows) {
    const ruc = c.ruc.replace(/[.\s]/g, '');
    if (!/^\d{1,8}(-\d)?$/.test(ruc)) { report.ruc.invalidos.push({ idcliente: c.idcliente, ruc: c.ruc }); continue; }
    report.ruc.consultados++;
    const r = await consultar(ruc);
    await sleep(DELAY_MS);
    if (!r.ok) { report.ruc.no_encontrados.push({ idcliente: c.idcliente, ruc: c.ruc, nombre: c.nombre_completo, motivo: r.motivo }); continue; }
    const nombre = up(r.data.razonSocial).slice(0, 120);
    let nuevoRuc = c.ruc;
    if (r.data.ruc && r.data.ruc !== c.ruc) {
      const otro = (await db.query('SELECT idcliente FROM cliente WHERE lower(btrim(ruc))=lower($1) AND idcliente<>$2', [r.data.ruc, c.idcliente])).rows[0];
      if (otro) report.ruc.conflictos.push({ idcliente: c.idcliente, ruc: c.ruc, ruc_oficial: r.data.ruc, ya_lo_tiene: otro.idcliente });
      else { nuevoRuc = r.data.ruc; report.ruc.ruc_completado++; }
    }
    if (!nombre || (nombre === c.nombre_completo && nombre === c.razon_social && nuevoRuc === c.ruc)) continue;
    await db.query('UPDATE cliente SET nombre_completo=$2, razon_social=$2, ruc=$3 WHERE idcliente=$1', [c.idcliente, nombre, nuevoRuc]);
    report.ruc.actualizados++;
    report.cambios.push({ idcliente: c.idcliente, antes: { nombre: c.nombre_completo, razon_social: c.razon_social, ruc: c.ruc }, despues: { nombre, ruc: nuevoRuc }, estado: r.data.estado });
    process.stdout.write(`  #${c.idcliente} ${c.nombre_completo} → ${nombre}\n`);
  }
  await db.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(`RUC: ${report.ruc.consultados} consultados · ${report.ruc.actualizados} actualizados · ${report.ruc.ruc_completado} con DV completado · ${report.ruc.no_encontrados.length} no encontrados · ${report.ruc.invalidos.length} inválidos · ${report.ruc.conflictos.length} conflictos`);
  console.log(dryRun ? 'Simulación: no se guardó nada.' : 'Cambios guardados.');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Cancelado, no se guardó nada:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Informe: ${REPORT}`);
}
