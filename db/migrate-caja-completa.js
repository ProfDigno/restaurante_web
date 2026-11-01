import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261014)');
  await client.query(await readFile(new URL('./migrations/20261013_caja_completa.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Migración de gestión completa de caja aplicada');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
