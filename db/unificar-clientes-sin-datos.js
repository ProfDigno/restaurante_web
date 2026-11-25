import 'dotenv/config';
import pg from 'pg';
import { writeFile } from 'node:fs/promises';

// Clientes con el MISMO nombre y sin ningún dato (sin RUC, teléfono, dirección ni email): queda uno solo
// (el de ID menor). Los pedidos, cuentas y facturas de los demás pasan al que queda, y luego se borran.
// Los clientes con datos y el ocasional no se tocan.
//
//   node db/unificar-clientes-sin-datos.js --dry-run   solo informa
//   node db/unificar-clientes-sin-datos.js             aplica (todo o nada)
// Informe: ../clientes-sin-datos-report.json

const dryRun = process.argv.includes('--dry-run');
const REPORT = '../clientes-sin-datos-report.json';
const db = new pg.Client({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '', database: process.env.DB_NAME });

await db.connect();
const report = { base: process.env.DB_NAME, modo: dryRun ? 'dry-run' : 'apply', generado: new Date().toISOString() };
try {
  await db.query('BEGIN');
  await db.query('LOCK TABLE cliente IN SHARE ROW EXCLUSIVE MODE');
  await db.query(`CREATE TEMP TABLE unificar ON COMMIT DROP AS
    WITH c AS (
      SELECT idcliente, notas, upper(regexp_replace(btrim(nombre_completo), '\\s+', ' ', 'g')) AS k
      FROM cliente
      WHERE NOT es_ocacional AND ruc IS NULL AND telefono IS NULL AND direccion IS NULL AND email IS NULL
    )
    SELECT idcliente AS absorbido, min(idcliente) OVER (PARTITION BY k) AS queda, k, notas FROM c`);
  await db.query('DELETE FROM unificar WHERE absorbido = queda');

  report.grupos = (await db.query('SELECT count(DISTINCT queda)::int n FROM unificar')).rows[0].n;
  report.absorbidos = (await db.query('SELECT count(*)::int n FROM unificar')).rows[0].n;
  // Las referencias (pedido, cuenta, factura) pasan al cliente que queda.
  report.referencias = {};
  const fks = (await db.query(`SELECT cl.relname t, a.attname col FROM pg_constraint con JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=con.conkey[1] WHERE con.contype='f' AND con.confrelid='cliente'::regclass`)).rows;
  for (const fk of fks) report.referencias[`${fk.t}.${fk.col}`] = (await db.query(`UPDATE ${fk.t} x SET ${fk.col}=u.queda FROM unificar u WHERE x.${fk.col}=u.absorbido`)).rowCount;
  // Las notas de los absorbidos (p. ej. de la migración) se agregan al que queda.
  await db.query(`UPDATE cliente c SET notas = NULLIF(concat_ws(' · ', c.notas, n.notas), '')
    FROM (SELECT queda, string_agg(notas, ' · ' ORDER BY absorbido) notas FROM unificar WHERE notas IS NOT NULL GROUP BY queda) n WHERE c.idcliente = n.queda`);
  report.borrados = (await db.query('DELETE FROM cliente c USING unificar u WHERE c.idcliente = u.absorbido')).rowCount;
  report.ejemplos = (await db.query(`SELECT k AS nombre, queda, array_agg(absorbido ORDER BY absorbido) absorbidos FROM unificar GROUP BY k, queda ORDER BY count(*) DESC, k LIMIT 30`)).rows;
  const quedan = (await db.query(`SELECT count(*)::int n FROM (SELECT 1 FROM cliente WHERE NOT es_ocacional AND ruc IS NULL AND telefono IS NULL AND direccion IS NULL AND email IS NULL
    GROUP BY upper(regexp_replace(btrim(nombre_completo), '\\s+', ' ', 'g')) HAVING count(*) > 1) x`)).rows[0].n;
  if (quedan) throw new Error(`Quedaron ${quedan} nombres repetidos sin datos`);
  report.clientes_total = (await db.query('SELECT count(*)::int n FROM cliente')).rows[0].n;
  await db.query(dryRun ? 'ROLLBACK' : 'COMMIT');
  console.log(`${report.grupos} nombres repetidos · ${report.borrados} clientes sin datos eliminados · referencias movidas: ${JSON.stringify(report.referencias)} · quedan ${report.clientes_total} clientes`);
  console.log(dryRun ? 'Simulación: no se guardó nada.' : 'Cambios guardados.');
} catch (e) {
  await db.query('ROLLBACK').catch(() => {});
  report.error = e.message;
  console.error('Cancelado, no se guardó nada:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Informe: ${REPORT}`);
}
