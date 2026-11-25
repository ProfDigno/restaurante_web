import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

// Caja y finanzas · Máquinas POS: catálogo de máquinas de tarjeta. Nombre y número se guardan sin
// espacios sobrantes y son únicos sin distinguir mayúsculas. Por ahora no se relaciona con otras tablas.
const router = Router();
const limpiar = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); }
  catch (error) {
    if (error.code === '23505') { error.status = 409; error.message = 'Ya existe una máquina POS con ese nombre o número'; }
    else if (error.code === '23514') error.status = 400;
    next(error);
  }
};

router.get('/', route(async req => {
  const page = integer(req.query.page || 1, 'Página', 1), size = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const search = `%${String(req.query.search || '').trim()}%`;
  const where = 'WHERE nombre ILIKE $1 OR numero ILIKE $1';
  const total = (await pool.query(`SELECT count(*)::int AS total FROM maquina_pos ${where}`, [search])).rows[0].total;
  const items = (await pool.query(`SELECT * FROM maquina_pos ${where} ORDER BY orden, nombre, idmaquina_pos LIMIT $2 OFFSET $3`, [search, size, (page - 1) * size])).rows;
  return { items, total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
}));

async function save(c, req, editing) {
  const nombre = limpiar(textRequired(req.body?.nombre, 'El nombre'));
  const numero = limpiar(textRequired(req.body?.numero, 'El número'));
  if (nombre.length > 80) fail('El nombre admite hasta 80 caracteres');
  if (numero.length > 40) fail('El número admite hasta 40 caracteres');
  if (typeof req.body?.activo !== 'boolean') fail('El estado debe ser booleano');
  await c.query('LOCK TABLE maquina_pos IN SHARE ROW EXCLUSIVE MODE');
  const self = editing ? id(req.params.id) : 0;
  // Mensajes claros antes de chocar con los índices únicos.
  const sameName = (await c.query('SELECT nombre FROM maquina_pos WHERE lower(nombre)=lower($1) AND idmaquina_pos<>$2', [nombre, self])).rows[0];
  if (sameName) fail(`Ya existe la máquina POS "${sameName.nombre}"`, 409);
  const sameNumber = (await c.query('SELECT nombre, numero FROM maquina_pos WHERE lower(numero)=lower($1) AND idmaquina_pos<>$2', [numero, self])).rows[0];
  if (sameNumber) fail(`El número ${sameNumber.numero} ya lo tiene la máquina POS "${sameNumber.nombre}"`, 409);
  if (editing) {
    const result = await c.query('UPDATE maquina_pos SET nombre=$1, numero=$2, activo=$3 WHERE idmaquina_pos=$4 RETURNING *', [nombre, numero, req.body.activo, self]);
    if (!result.rowCount) fail('Máquina POS no encontrada', 404);
    return { item: result.rows[0] };
  }
  const next = (await c.query('SELECT COALESCE(MAX(orden),0)+1 AS orden FROM maquina_pos')).rows[0].orden;
  if (next > 32767) fail('Se alcanzó el máximo de orden');
  return { item: (await c.query('INSERT INTO maquina_pos(nombre, numero, activo, orden, creado_por) VALUES($1,$2,$3,$4,$5) RETURNING *', [nombre, numero, req.body.activo, next, req.user.login])).rows[0] };
}
router.post('/', route(req => operation(req, c => save(c, req, false))));
router.put('/:id', route(req => operation(req, c => save(c, req, true))));
router.post('/:id/orden', route(req => operation(req, async c => {
  if (!['up', 'down'].includes(req.body?.direction)) fail('Dirección inválida');
  await c.query('LOCK TABLE maquina_pos IN SHARE ROW EXCLUSIVE MODE');
  const rows = (await c.query('SELECT idmaquina_pos FROM maquina_pos ORDER BY orden, nombre, idmaquina_pos FOR UPDATE')).rows;
  const i = rows.findIndex(row => row.idmaquina_pos === id(req.params.id));
  if (i < 0) fail('Máquina POS no encontrada', 404);
  const j = i + (req.body.direction === 'up' ? -1 : 1);
  if (j < 0 || j >= rows.length) return { moved: false };
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) await c.query('UPDATE maquina_pos SET orden=$1::smallint WHERE idmaquina_pos=$2', [k + 1, rows[k].idmaquina_pos]);
  return { moved: true };
})));
export default router;
