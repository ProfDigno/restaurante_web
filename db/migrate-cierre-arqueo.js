import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Cierre de caja por arqueo (billetes + POS) y corrección de la forma de cobro.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261203_cierre_arqueo.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Arqueo de cierre de caja instalado');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
