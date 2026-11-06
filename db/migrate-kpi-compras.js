import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Agrega el permiso del formulario Análisis de compras (admin y encargado).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261106_kpi_compras_permiso.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Permiso FORM_KPI_COMPRAS disponible');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
