import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Módulo RR.HH.: columnas de personal, regla de límite de vale y permisos Personal/Vales (admin).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261107_rrhh.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Módulo RR.HH. instalado (personal, vales y permisos)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
