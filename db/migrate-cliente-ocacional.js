import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261013)');
  await client.query(await readFile(new URL('./migrations/20261012_cliente_ocacional.sql', import.meta.url), 'utf8'));
  const result = await client.query('SELECT count(*)::int AS total FROM cliente WHERE es_ocacional');
  await client.query('COMMIT');
  console.log(`Migración de cliente ocasional aplicada; ${result.rows[0].total} cliente(s) marcado(s)`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
