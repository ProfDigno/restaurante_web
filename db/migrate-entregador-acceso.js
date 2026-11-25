import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Entregador de delivery: campos de acceso (usuario y contraseña).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261129_entregador_acceso.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Campos de acceso del entregador instalados');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
