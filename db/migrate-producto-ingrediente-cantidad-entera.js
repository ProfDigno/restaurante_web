import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(2026101401)');
  await client.query(await readFile(new URL('./migrations/20261014_producto_ingrediente_cantidad_entera.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Cantidades de ingredientes del producto convertidas a enteros');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
