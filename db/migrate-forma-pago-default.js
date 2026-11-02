import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261013)');
  await client.query(await readFile(new URL('./migrations/20261102_forma_pago_default.sql', import.meta.url), 'utf8'));
  const result = await client.query('SELECT nombre FROM forma_pago WHERE es_default');
  await client.query('COMMIT');
  console.log(`Migración de forma de pago por defecto aplicada; por defecto: ${result.rows[0]?.nombre ?? 'ninguna (definila en Formas de pago)'}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
