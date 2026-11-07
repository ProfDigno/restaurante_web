import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { formDefinitions, permissionCode } from '../config/menu.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { auditar, cambios } from '../services/auditoria.js';

const router = Router();
const knownCodes = new Set(formDefinitions.map(form => form.code));
const managementCodes = ['usuarios', 'roles', 'permisos'].map(permissionCode);
const route = handler => async (req, res, next) => {
  try { const result = await handler(req); res.json(result); }
  catch (error) {
    if (error.code === '23505') { error.status = 409; error.message = 'Ya existe un registro con ese nombre o usuario'; }
    if (error.code === '23503') { error.status = 400; error.message = 'El rol o permiso seleccionado no existe'; }
    next(error);
  }
};
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const id = value => { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) fail('Identificador inválido'); return number; };
const pageArgs = query => {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = [25, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) : 25;
  return { page, pageSize, offset: (page - 1) * pageSize, search: `%${String(query.search || '').trim()}%` };
};
async function transaction(handler) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(2026101502)');
    const value = await handler(client);
    const managers = await client.query(`
      SELECT u.idusuario FROM usuario u
      JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol AND r.activo
      JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol AND i.activo
      JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.activo
      WHERE u.activo AND e.codigo_evento=ANY($1::text[])
      GROUP BY u.idusuario HAVING count(DISTINCT e.codigo_evento)=$2 LIMIT 1`, [managementCodes, managementCodes.length]);
    if (!managers.rowCount) fail('Debe quedar al menos un usuario activo con acceso a Usuarios, Roles y Permisos', 409);
    await client.query('COMMIT');
    return value;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
const userSelect = `SELECT u.idusuario,u.fecha_creado,u.creado_por,u.login,u.nombre,u.activo,
  u.fk_idusuario_rol,r.rol FROM usuario u LEFT JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol`;
const roleSelect = `SELECT r.idusuario_rol,r.fecha_creado,r.creado_por,r.rol,r.activo,
  COALESCE(array_agg(DISTINCT e.codigo_evento ORDER BY e.codigo_evento) FILTER (WHERE i.activo AND e.activo AND e.codigo_evento LIKE 'FORM_%'),'{}') AS permisos,
  count(DISTINCT u.idusuario)::int AS usuarios
  FROM usuario_rol r LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol
  LEFT JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento
  LEFT JOIN usuario u ON u.fk_idusuario_rol=r.idusuario_rol AND u.activo`;
const permissionSelect = `SELECT e.idusuario_rol_evento,e.fecha_creado,e.creado_por,e.nombre,e.descripcion,e.codigo_evento,e.activo,
  count(DISTINCT i.fk_idusuario_rol) FILTER (WHERE i.activo)::int AS roles
  FROM usuario_rol_evento e LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol_evento=e.idusuario_rol_evento`;

router.get('/roles/opciones', requireAuth, requirePermission('usuarios'), route(async () => ({
  items: (await pool.query('SELECT idusuario_rol,rol FROM usuario_rol WHERE activo ORDER BY rol')).rows
})));

router.use('/usuarios', requireAuth, requirePermission('usuarios'));
router.get('/usuarios', route(async req => {
  const { page, pageSize, offset, search } = pageArgs(req.query);
  const [items, count] = await Promise.all([
    pool.query(`${userSelect} WHERE u.login ILIKE $1 OR u.nombre ILIKE $1 ORDER BY u.idusuario LIMIT $2 OFFSET $3`, [search, pageSize, offset]),
    pool.query('SELECT count(*)::int AS total FROM usuario WHERE login ILIKE $1 OR nombre ILIKE $1', [search])
  ]);
  const total = count.rows[0].total;
  return { items: items.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));
async function saveUser(req, editing) {
  const body = req.body || {};
  const login = String(body.login || '').trim();
  const nombre = String(body.nombre || '').trim();
  const roleId = id(body.fk_idusuario_rol);
  const password = String(body.password || '');
  if (!login || login.length > 50 || !nombre || nombre.length > 120) fail('Ingresá usuario y nombre válidos');
  if ((!editing || password) && password.length < 8) fail('La contraseña debe tener al menos 8 caracteres');
  if (password.length > 100) fail('La contraseña es demasiado larga');
  return transaction(async client => {
    if (!(await client.query('SELECT 1 FROM usuario_rol WHERE idusuario_rol=$1 AND activo', [roleId])).rowCount) fail('Seleccioná un rol activo');
    let userId;
    const userFields = ['login', 'nombre', 'rol', 'activo'];
    const userAudit = async idValue => (await client.query('SELECT u.login,u.nombre,r.rol,u.activo FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE u.idusuario=$1', [idValue])).rows[0];
    if (editing) {
      userId = id(req.params.id);
      const before = await userAudit(userId);
      const result = await client.query(`UPDATE usuario SET login=$1,nombre=$2,fk_idusuario_rol=$3,activo=$4
        WHERE idusuario=$5 RETURNING idusuario`, [login, nombre, roleId, body.activo !== false, userId]);
      if (!result.rowCount) fail('Usuario no encontrado', 404);
      if (password) await client.query('UPDATE usuario SET password_hash=$1 WHERE idusuario=$2', [await bcrypt.hash(password, 12), userId]);
      // Nunca se guarda la contraseña ni su hash: solo que fue cambiada.
      const diff = cambios(before, await userAudit(userId), userFields);
      if (diff || password) await auditar(client, req.user, { accion: 'USUARIO_MODIFICADO', entidad: 'usuario', id: userId,
        antes: diff?.antes || {}, despues: { ...(diff?.despues || {}), ...(password ? { contrasena: 'cambiada' } : {}) } });
    } else {
      const result = await client.query(`INSERT INTO usuario(login,nombre,password_hash,fk_idusuario_rol,activo,creado_por)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING idusuario`, [login, nombre, await bcrypt.hash(password, 12), roleId, body.activo !== false, req.user.login]);
      userId = result.rows[0].idusuario;
      await auditar(client, req.user, { accion: 'USUARIO_CREADO', entidad: 'usuario', id: userId, despues: await userAudit(userId) });
    }
    return { item: (await client.query(`${userSelect} WHERE u.idusuario=$1`, [userId])).rows[0] };
  });
}
router.post('/usuarios', route(req => saveUser(req, false)));
router.put('/usuarios/:id', route(req => saveUser(req, true)));

router.use('/roles', requireAuth, requirePermission('roles'));
router.get('/roles', route(async req => {
  const { page, pageSize, offset, search } = pageArgs(req.query);
  const [items, count] = await Promise.all([
    pool.query(`${roleSelect} WHERE r.rol ILIKE $1 GROUP BY r.idusuario_rol ORDER BY r.rol LIMIT $2 OFFSET $3`, [search, pageSize, offset]),
    pool.query('SELECT count(*)::int AS total FROM usuario_rol WHERE rol ILIKE $1', [search])
  ]);
  const total = count.rows[0].total;
  return { items: items.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));
async function saveRole(req, editing) {
  const body = req.body || {};
  const name = String(body.rol || '').trim();
  const codes = body.permisos ?? [];
  if (!name || name.length > 80) fail('Ingresá un nombre de rol válido');
  if (!Array.isArray(codes) || new Set(codes).size !== codes.length || codes.some(code => !knownCodes.has(code))) fail('La lista de permisos es inválida');
  return transaction(async client => {
    let roleId, before = null;
    const roleAudit = async idValue => (await client.query(`SELECT r.rol,r.activo,
        COALESCE(array_agg(e.codigo_evento ORDER BY e.codigo_evento) FILTER (WHERE i.activo AND e.codigo_evento LIKE 'FORM_%'), '{}') AS permisos
      FROM usuario_rol r LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol
      LEFT JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento
      WHERE r.idusuario_rol=$1 GROUP BY r.idusuario_rol`, [idValue])).rows[0];
    if (editing) {
      roleId = id(req.params.id);
      before = await roleAudit(roleId);
      const updated = await client.query('UPDATE usuario_rol SET rol=$1,activo=$2 WHERE idusuario_rol=$3 RETURNING idusuario_rol', [name, body.activo !== false, roleId]);
      if (!updated.rowCount) fail('Rol no encontrado', 404);
    } else {
      roleId = (await client.query('INSERT INTO usuario_rol(rol,activo,creado_por) VALUES($1,$2,$3) RETURNING idusuario_rol', [name, body.activo !== false, req.user.login])).rows[0].idusuario_rol;
    }
    await client.query("UPDATE usuario_rol_item i SET activo=false FROM usuario_rol_evento e WHERE i.fk_idusuario_rol=$1 AND e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.codigo_evento LIKE 'FORM_%'", [roleId]);
    for (const code of codes) {
      const inserted = await client.query(`INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
        SELECT $1,e.idusuario_rol_evento,$3 FROM usuario_rol_evento e WHERE e.codigo_evento=$2 AND e.activo
        ON CONFLICT(fk_idusuario_rol,fk_idusuario_rol_evento) DO UPDATE SET activo=true`, [roleId, code, req.user.login]);
      if (!inserted.rowCount) fail(`El permiso ${code} no está activo`);
    }
    const after = await roleAudit(roleId);
    if (!editing) await auditar(client, req.user, { accion: 'ROL_CREADO', entidad: 'rol', id: roleId, despues: after });
    else {
      const quitados = before.permisos.filter(code => !after.permisos.includes(code));
      const agregados = after.permisos.filter(code => !before.permisos.includes(code));
      const diff = cambios(before, after, ['rol', 'activo']);
      if (diff || quitados.length || agregados.length) await auditar(client, req.user, { accion: 'ROL_MODIFICADO', entidad: 'rol', id: roleId,
        antes: { ...(diff?.antes || {}), ...(quitados.length ? { permisos_quitados: quitados } : {}) },
        despues: { ...(diff?.despues || {}), ...(agregados.length ? { permisos_agregados: agregados } : {}) } });
    }
    return { item: (await client.query(`${roleSelect} WHERE r.idusuario_rol=$1 GROUP BY r.idusuario_rol`, [roleId])).rows[0] };
  });
}
router.post('/roles', route(req => saveRole(req, false)));
router.put('/roles/:id', route(req => saveRole(req, true)));

router.use('/permisos', requireAuth, requirePermission('permisos', ['roles']));
router.get('/permisos', route(async req => {
  const { page, pageSize, offset, search } = pageArgs(req.query);
  const codes = [...knownCodes];
  const [items, count] = await Promise.all([
    pool.query(`${permissionSelect} WHERE e.codigo_evento=ANY($1::text[]) AND (e.nombre ILIKE $2 OR e.codigo_evento ILIKE $2)
      GROUP BY e.idusuario_rol_evento ORDER BY e.nombre LIMIT $3 OFFSET $4`, [codes, search, pageSize, offset]),
    pool.query('SELECT count(*)::int AS total FROM usuario_rol_evento WHERE codigo_evento=ANY($1::text[]) AND (nombre ILIKE $2 OR codigo_evento ILIKE $2)', [codes, search])
  ]);
  const total = count.rows[0].total;
  return { items: items.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));
router.put('/permisos/:id', requirePermission('permisos'), route(async req => {
  const body = req.body || {};
  const nombre = String(body.nombre || '').trim();
  const descripcion = String(body.descripcion || '').trim();
  if (!nombre || nombre.length > 150 || descripcion.length > 500) fail('Ingresá un nombre y descripción válidos');
  return transaction(async client => {
    const permissionId = id(req.params.id);
    const before = (await client.query('SELECT codigo_evento,nombre,descripcion,activo FROM usuario_rol_evento WHERE idusuario_rol_evento=$1', [permissionId])).rows[0];
    const updated = await client.query(`UPDATE usuario_rol_evento SET nombre=$1,descripcion=$2,activo=$3
      WHERE idusuario_rol_evento=$4 AND codigo_evento=ANY($5::text[]) RETURNING idusuario_rol_evento`, [nombre, descripcion, body.activo !== false, permissionId, [...knownCodes]]);
    if (!updated.rowCount) fail('Permiso no encontrado', 404);
    const diff = cambios(before, { nombre, descripcion, activo: body.activo !== false }, ['nombre', 'descripcion', 'activo']);
    if (diff) await auditar(client, req.user, { accion: 'PERMISO_MODIFICADO', entidad: 'permiso', id: permissionId,
      antes: { codigo: before.codigo_evento, ...diff.antes }, despues: diff.despues });
    return { item: (await client.query(`${permissionSelect} WHERE e.idusuario_rol_evento=$1 GROUP BY e.idusuario_rol_evento`, [permissionId])).rows[0] };
  });
}));

export default router;
