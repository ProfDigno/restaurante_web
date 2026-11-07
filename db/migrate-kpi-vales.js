import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Permiso del Análisis de vales (RR.HH.).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261107_kpi_vales.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Análisis de vales instalado (permiso)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
