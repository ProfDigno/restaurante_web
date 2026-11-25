import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Forma de pago: indica si se cobra con la máquina de tarjeta (POS).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261126_forma_pago_usa_pos.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Columna usa_pos de forma de pago instalada');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
