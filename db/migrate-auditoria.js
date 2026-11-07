import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Auditoría: tabla de solo inserción y permiso del formulario Auditoría (admin).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261107_auditoria.sql', import.meta.url), 'utf8'));
  await client.query(await readFile(new URL('./migrations/20261107_auditoria_permiso.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Auditoría instalada (tabla, protección contra cambios y permiso)');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
