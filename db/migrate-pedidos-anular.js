import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Permiso de rol para anular pedidos (se asigna a admin/administrador y a quien administra Permisos).
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261127_pedidos_anular_permiso.sql', import.meta.url), 'utf8'));
  const { rows } = await client.query(`SELECT r.rol FROM usuario_rol r JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol
    JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento WHERE e.codigo_evento='FORM_PEDIDOS_ANULAR' ORDER BY r.rol`);
  await client.query('COMMIT');
  console.log(`Permiso "Pedidos: anular" instalado; roles con el permiso: ${rows.map(r => r.rol).join(', ') || 'ninguno'}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
