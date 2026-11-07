import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Observación con precio por producto de cocina en el pedido.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261108_observacion_detalle.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Observación de producto instalada (precio_observacion y total del pedido)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
