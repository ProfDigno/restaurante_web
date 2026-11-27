import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Factura pre-impresa en triplicado e impresora de factura por PC.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(20261202)');
  await client.query(await readFile(new URL('./migrations/20261202_factura_preimpresa.sql', import.meta.url), 'utf8'));
  await client.query('COMMIT');
  console.log('Factura pre-impresa instalada: modo de facturación, estado emitida e impresora de factura por PC');
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
