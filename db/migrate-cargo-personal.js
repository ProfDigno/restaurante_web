import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Cargos del personal como catálogo: tabla, paso de los cargos existentes (sin duplicados) y permiso Cargos.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  const before = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='personal' AND column_name='cargo'");
  await client.query(await readFile(new URL('./migrations/20261108_cargo_personal.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('./migrations/20261108_cargo_personal_permiso.sql', import.meta.url), 'utf8'));
  const { rows: [r] } = await client.query(`SELECT (SELECT count(*) FROM cargo_personal)::int AS cargos,
    (SELECT count(*) FROM personal WHERE fk_idcargo_personal IS NOT NULL)::int AS con_cargo, (SELECT count(*) FROM personal)::int AS personal`);
  await client.query('COMMIT');
  console.log(`Cargos instalados: ${r.cargos} cargos, ${r.con_cargo} de ${r.personal} personas con cargo${before.rowCount ? ' (columna de texto migrada y eliminada)' : ''}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
