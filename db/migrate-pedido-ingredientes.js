import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(2026101501)');
  await client.query(await readFile(new URL('./migrations/20261015_pedido_ingredientes.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Importes de ingredientes del pedido actualizados');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
