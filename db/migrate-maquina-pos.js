import { readFile } from 'node:fs/promises';
import { pool } from '../src/config/database.js';

// Caja y finanzas · Máquinas POS: tabla y permiso del formulario.
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(await readFile(new URL('./migrations/20261128_maquina_pos.sql', import.meta.url), 'utf8'));
  const { rows } = await client.query(`SELECT r.rol FROM usuario_rol r JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol
    JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento WHERE e.codigo_evento='FORM_MAQUINAS_POS' ORDER BY r.rol`);
  await client.query('COMMIT');
  console.log(`Máquinas POS instaladas; roles con el permiso: ${rows.map(r => r.rol).join(', ') || 'ninguno'}`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
