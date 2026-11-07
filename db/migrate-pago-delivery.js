import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Pagos a delivery: tablas, tipo de gasto "Pago a delivery" y permiso del formulario.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261108_pago_delivery.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('./migrations/20261108_pago_delivery_permiso.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Pagos a delivery instalados (tablas, tipo de gasto y permiso)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
