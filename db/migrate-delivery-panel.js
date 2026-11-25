import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Panel del entregador: forma de pago indicada en el pedido.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261130_delivery_panel.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Panel del entregador instalado');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
