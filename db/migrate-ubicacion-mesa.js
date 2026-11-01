import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(202610131)');
  await client.query(await readFile(new URL('./migrations/20261013_ubicacion_mesa.sql', import.meta.url), 'utf8'));
  const { rows } = await client.query(`
    SELECT
      (SELECT count(*)::int FROM ubicacion_mesa) AS ubicaciones,
      (SELECT count(*)::int FROM mesa) AS mesas,
      (SELECT count(*)::int FROM mesa WHERE fk_idubicacion_mesa IS NULL) AS mesas_sin_ubicacion`);
  await client.query('COMMIT');
  console.log(`Migración aplicada: ${rows[0].ubicaciones} ubicaciones, ${rows[0].mesas} mesas, ${rows[0].mesas_sin_ubicacion} sin ubicación`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
