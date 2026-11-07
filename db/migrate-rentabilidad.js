import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Rentabilidad: costo del ingrediente al vender y permiso del Análisis de rentabilidad.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261107_rentabilidad.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Rentabilidad instalada (costo al vender y permiso)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
