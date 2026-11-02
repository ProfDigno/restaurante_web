import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261013)');
  await client.query(await readFile(new URL('./migrations/20261101_cliente_rapido.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Migración de cliente rápido aplicada: RUC y teléfono ahora son opcionales');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
