import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const folder = process.env.SAMU_BACKUP_DIR;
assert.ok(folder, 'Definí SAMU_BACKUP_DIR');
const targetName = process.env.SAMU_TARGET_DB || process.env.DB_NAME || 'bdrestaurante_web';
const reportName = targetName.startsWith('samu_test_') ? 'migration-test-report.json' : 'migration-report.json';
const report = JSON.parse(await readFile(path.join(folder, reportName), 'utf8'));
assert.equal(report.targetDatabase, targetName);
const client = new pg.Client({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: targetName });
await client.connect();
const checks = {};
async function count(sql, params = []) { return Number((await client.query(sql, params)).rows[0].n); }
try {
  for (const [table, expected] of Object.entries({ categoria_menu: 11, unidad_menu: 25, grupo_menu: 2, producto_menu: 165, cliente: 28, zona_cliente: report.preserved.zona_cliente + 51, usuario: report.preserved.usuario, mesa: report.preserved.mesa, forma_pago: report.preserved.forma_pago, ingrediente: report.preserved.ingrediente })) {
    checks[table] = await count(`SELECT count(*)::int n FROM ${table}`);
    assert.equal(checks[table], expected, `${table}: cantidad incorrecta`);
  }
  for (const table of Object.keys(report.before)) {
    if (['categoria_menu', 'unidad_menu', 'grupo_menu', 'producto_menu', 'cliente'].includes(table)) continue;
    assert.equal(await count(`SELECT count(*)::int n FROM ${table}`), 0, `${table}: historial no limpio`);
  }
  assert.equal(await count("SELECT count(*)::int n FROM mesa WHERE estado<>'libre'"), 0);
  assert.equal(await count('SELECT count(*)::int n FROM producto_menu p LEFT JOIN categoria_menu c ON c.idcategoria_menu=p.fk_idcategoria_menu LEFT JOIN unidad_menu u ON u.idunidad_menu=p.fk_idunidad_menu LEFT JOIN grupo_menu g ON g.idgrupo_menu=p.fk_idgrupo_menu WHERE c.idcategoria_menu IS NULL OR u.idunidad_menu IS NULL OR g.idgrupo_menu IS NULL'), 0);
  assert.equal(await count('SELECT count(*)::int n FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente=c.fk_idzona_cliente WHERE z.idzona_cliente IS NULL'), 0);
  assert.equal(await count('SELECT count(*)::int n FROM cliente WHERE btrim(ruc)=\'\' OR btrim(telefono)=\'\''), 0);
  assert.equal(await count('SELECT count(*)::int n FROM (SELECT lower(btrim(ruc)) FROM cliente GROUP BY 1 HAVING count(*)>1) x'), 0);
  assert.equal(await count('SELECT count(*)::int n FROM (SELECT btrim(telefono) FROM cliente GROUP BY 1 HAVING count(*)>1) x'), 0);
  assert.equal(await count('SELECT count(*)::int n FROM producto_menu WHERE stock_actual<0'), 0);
  assert.equal(await count('SELECT count(*)::int n FROM zona_cliente WHERE creado_por=\'MIGRACION_SAMU\''), 51);
  assert.equal(Object.keys(report.zoneIdMap).length, 56);
  for (const [sequence, table, id] of [['categoria_menu_id_seq','categoria_menu','idcategoria_menu'],['unidad_menu_id_seq','unidad_menu','idunidad_menu'],['grupo_menu_id_seq','grupo_menu','idgrupo_menu'],['producto_menu_id_seq','producto_menu','idproducto_menu'],['cliente_id_seq','cliente','idcliente'],['zona_cliente_id_seq','zona_cliente','idzona_cliente']]) {
    const { rows } = await client.query(`SELECT (SELECT last_value FROM ${sequence}) AS last, (SELECT max(${id}) FROM ${table}) AS maximum`);
    assert.ok(Number(rows[0].last) > Number(rows[0].maximum), `${sequence}: secuencia atrasada`);
  }
  checks.integrity = 'OK';
  const file = path.join(folder, targetName.startsWith('samu_test_') ? 'verification-test.json' : 'verification.json');
  await writeFile(file, `${JSON.stringify({ verifiedAt: new Date().toISOString(), database: targetName, checks }, null, 2)}\n`, 'utf8');
  console.log(`Verificación completa: ${JSON.stringify(checks)}`);
} finally { await client.end(); }
