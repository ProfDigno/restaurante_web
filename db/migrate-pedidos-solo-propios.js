import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Permiso de rol para ver solo los pedidos propios.
try {
  await pool.query(await readFile(new URL('./migrations/20261120_pedidos_solo_propios_permiso.sql', import.meta.url), 'utf8'));
  console.log('Permiso "Pedidos: ver solo los propios" instalado');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
