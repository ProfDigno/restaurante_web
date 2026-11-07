import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

// RR.HH. · Cargos del personal: catálogo sin duplicados. El nombre se guarda sin espacios sobrantes
// y es único sin distinguir mayúsculas ("Cocinera" = "COCINERA" = " cocinera ").
const router = Router();
export const normalizarCargo = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); }
  catch (error) {
    if (error.code === '23505') { error.status = 409; error.message = 'Ya existe un cargo con ese nombre (sin distinguir mayúsculas)'; }
    else if (error.code === '23514') error.status = 400;
    next(error);
  }
};
const select = `SELECT c.*, (SELECT count(*) FROM personal p WHERE p.fk_idcargo_personal=c.idcargo_personal)::int AS personas,
  (SELECT count(*) FROM personal p WHERE p.fk_idcargo_personal=c.idcargo_personal AND p.activo)::int AS personas_activas
  FROM cargo_personal c`;

// Lista completa para el selector de Personal (activos e inactivos; el formulario ofrece solo los activos).
router.get('/opciones', route(async () => ({
  items: (await pool.query('SELECT idcargo_personal, nombre, activo FROM cargo_personal ORDER BY orden, nombre')).rows
})));

router.get('/', route(async req => {
  const page = integer(req.query.page || 1, 'Página', 1), size = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const search = `%${String(req.query.search || '').trim()}%`;
  const total = (await pool.query('SELECT count(*)::int AS total FROM cargo_personal WHERE nombre ILIKE $1', [search])).rows[0].total;
  const items = (await pool.query(`${select} WHERE c.nombre ILIKE $1 ORDER BY c.orden, c.nombre, c.idcargo_personal LIMIT $2 OFFSET $3`, [search, size, (page - 1) * size])).rows;
  return { items, total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
}));

async function save(c, req, editing) {
  const nombre = normalizarCargo(textRequired(req.body?.nombre, 'El nombre'));
  if (nombre.length > 80) fail('El nombre admite hasta 80 caracteres');
  if (typeof req.body?.activo !== 'boolean') fail('El estado debe ser booleano');
  await c.query('LOCK TABLE cargo_personal IN SHARE ROW EXCLUSIVE MODE');
  // Mensaje claro antes de chocar con el índice único: dice cuál es el cargo que ya existe.
  const twin = (await c.query('SELECT idcargo_personal, nombre FROM cargo_personal WHERE lower(nombre)=lower($1) AND idcargo_personal<>$2', [nombre, editing ? id(req.params.id) : 0])).rows[0];
  if (twin) fail(`Ya existe el cargo "${twin.nombre}"`, 409);
  if (editing) {
    const result = await c.query('UPDATE cargo_personal SET nombre=$1, activo=$2 WHERE idcargo_personal=$3 RETURNING idcargo_personal', [nombre, req.body.activo, id(req.params.id)]);
    if (!result.rowCount) fail('Cargo no encontrado', 404);
    return { item: (await c.query(`${select} WHERE c.idcargo_personal=$1`, [result.rows[0].idcargo_personal])).rows[0] };
  }
  const next = (await c.query('SELECT COALESCE(MAX(orden),0)+1 AS orden FROM cargo_personal')).rows[0].orden;
  if (next > 32767) fail('Se alcanzó el máximo de orden');
  const created = (await c.query('INSERT INTO cargo_personal(nombre, activo, orden, creado_por) VALUES($1,$2,$3,$4) RETURNING idcargo_personal', [nombre, req.body.activo, next, req.user.login])).rows[0];
  return { item: (await c.query(`${select} WHERE c.idcargo_personal=$1`, [created.idcargo_personal])).rows[0] };
}
router.post('/', route(req => operation(req, c => save(c, req, false))));
router.put('/:id', route(req => operation(req, c => save(c, req, true))));
router.post('/:id/orden', route(req => operation(req, async c => {
  if (!['up', 'down'].includes(req.body?.direction)) fail('Dirección inválida');
  await c.query('LOCK TABLE cargo_personal IN SHARE ROW EXCLUSIVE MODE');
  const rows = (await c.query('SELECT idcargo_personal FROM cargo_personal ORDER BY orden, nombre, idcargo_personal FOR UPDATE')).rows;
  const i = rows.findIndex(row => row.idcargo_personal === id(req.params.id));
  if (i < 0) fail('Cargo no encontrado', 404);
  const j = i + (req.body.direction === 'up' ? -1 : 1);
  if (j < 0 || j >= rows.length) return { moved: false };
  [rows[i], rows[j]] = [rows[j], rows[i]];
  for (let k = 0; k < rows.length; k++) await c.query('UPDATE cargo_personal SET orden=$1::smallint WHERE idcargo_personal=$2', [k + 1, rows[k].idcargo_personal]);
  return { moved: true };
})));
export default router;
