import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireCurrentForm);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = pageSizeValue(req.query.pageSize);
    const pattern = `%${search}%`;
    const offset = (page - 1) * pageSize;
    const [list, count] = await Promise.all([
      pool.query(`SELECT idunidad_menu, fecha_creado, creado_por, nombre, orden, activo FROM unidad_menu WHERE nombre ILIKE $1 ORDER BY orden, nombre, idunidad_menu LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]),
      pool.query(`SELECT count(*)::int AS total FROM unidad_menu WHERE nombre ILIKE $1`, [pattern])
    ]);
    const total = count.rows[0].total;
    res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await pool.query(`INSERT INTO unidad_menu (nombre, orden, activo, creado_por) SELECT $1, (COALESCE(MAX(orden), 0) + 1)::smallint, $2, $3 FROM unidad_menu RETURNING idunidad_menu, fecha_creado, creado_por, nombre, orden, activo`, [nombre, req.body?.activo !== false, req.user.login]);
    res.status(201).json({ item: rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una unidad de menú con ese nombre' }); next(error); }
});

router.post('/:id/orden', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const direction = req.body?.direction;
    if (!Number.isInteger(id) || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Movimiento de orden inválido' });
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT idunidad_menu, orden FROM unidad_menu ORDER BY orden, nombre, idunidad_menu FOR UPDATE`);
    const index = rows.findIndex((item) => item.idunidad_menu === id);
    if (index < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Unidad de menú no encontrada' }); }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= rows.length) { await client.query('COMMIT'); return res.json({ moved: false }); }
    const current = rows[index]; const neighbor = rows[neighborIndex];
    await client.query(`UPDATE unidad_menu SET orden = CASE idunidad_menu WHEN $1::integer THEN $2::smallint WHEN $3::integer THEN $4::smallint END WHERE idunidad_menu IN ($1::integer, $3::integer)`, [current.idunidad_menu, neighbor.orden, neighbor.idunidad_menu, current.orden]);
    await client.query('COMMIT');
    res.json({ moved: true });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await pool.query(`UPDATE unidad_menu SET nombre = $1, activo = $2 WHERE idunidad_menu = $3 RETURNING idunidad_menu, fecha_creado, creado_por, nombre, orden, activo`, [nombre, req.body?.activo !== false, Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Unidad de menú no encontrada' });
    res.json({ item: rows[0] });
  } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una unidad de menú con ese nombre' }); next(error); }
});

export default router;
