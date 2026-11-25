import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Rendición del entregador: control del cierre de la máquina POS.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261201_rendicion_pos.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Control de POS en la rendición instalado');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
