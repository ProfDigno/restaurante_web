import { pool } from '../src/config/database.js';
import { formDefinitions } from '../src/config/menu.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(2026101503)');
  for (const form of formDefinitions) {
    await client.query(`INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
      VALUES($1,$2,$3,'SISTEMA') ON CONFLICT(codigo_evento) DO NOTHING`,
    [form.label, `Acceso al formulario ${form.label}`, form.code]);
  }
  const allCodes = formDefinitions.map(form => form.code);
  for (const [role, codes] of [
    ['admin', allCodes],
    ['encargado', allCodes.filter(code => !['FORM_USUARIOS', 'FORM_ROLES', 'FORM_PERMISOS', 'FORM_PERSONAL', 'FORM_VALES'].includes(code))],
    ['mozo', ['FORM_MESAS', 'FORM_PEDIDOS', 'FORM_COMANDA']]
  ]) {
    await client.query(`INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
      SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
      FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento=ANY($2::text[])
      WHERE r.rol=$1
      ON CONFLICT(fk_idusuario_rol,fk_idusuario_rol_evento) DO NOTHING`, [role, codes]);
  }
  await client.query('COMMIT');
  console.log(`${formDefinitions.length} permisos de formularios disponibles`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
