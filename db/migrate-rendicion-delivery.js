import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Rendición del entregador: tablas de la rendición y de sus pedidos.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261125_rendicion_delivery.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Rendición del entregador instalada');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
