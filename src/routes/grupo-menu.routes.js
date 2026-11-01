import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireCurrentForm);

const validPageSize = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = validPageSize(req.query.pageSize);
    const offset = (page - 1) * pageSize;
    const params = [`%${search}%`, pageSize, offset];
    const [rowsResult, countResult] = await Promise.all([
      pool.query(`
        SELECT idgrupo_menu, fecha_creado, creado_por, nombre, orden, activo
        FROM grupo_menu
        WHERE nombre ILIKE $1
        ORDER BY orden, nombre, idgrupo_menu
        LIMIT $2 OFFSET $3`, params),
      pool.query('SELECT count(*)::int AS total FROM grupo_menu WHERE nombre ILIKE $1', [params[0]])
    ]);
    res.json({ items: rowsResult.rows, total: countResult.rows[0].total, page, pageSize, totalPages: Math.max(1, Math.ceil(countResult.rows[0].total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await pool.query(`INSERT INTO grupo_menu (nombre, orden, activo, creado_por) SELECT $1, (COALESCE(MAX(orden), 0) + 1)::smallint, $2, $3 FROM grupo_menu RETURNING idgrupo_menu, fecha_creado, creado_por, nombre, orden, activo`, [nombre, req.body?.activo !== false, req.user.login]);
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un grupo con ese nombre' });
    next(error);
  }
});

router.post('/:id/orden', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const direction = req.body?.direction;
    if (!Number.isInteger(id) || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Movimiento de orden inválido' });
    await client.query('BEGIN');
    const { rows } = await client.query(`
      SELECT idgrupo_menu, orden
      FROM grupo_menu
      ORDER BY orden, nombre, idgrupo_menu
      FOR UPDATE`);
    const index = rows.findIndex((item) => item.idgrupo_menu === id);
    if (index < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Grupo de menú no encontrado' }); }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= rows.length) { await client.query('COMMIT'); return res.json({ moved: false }); }
    const current = rows[index];
    const neighbor = rows[neighborIndex];
    await client.query(`
      UPDATE grupo_menu
      SET orden = CASE idgrupo_menu
        WHEN $1::integer THEN $2::smallint
        WHEN $3::integer THEN $4::smallint
      END
      WHERE idgrupo_menu IN ($1::integer, $3::integer)`, [current.idgrupo_menu, neighbor.orden, neighbor.idgrupo_menu, current.orden]);
    await client.query('COMMIT');
    res.json({ moved: true });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const { rows } = await pool.query(`UPDATE grupo_menu SET nombre = $1, activo = $2 WHERE idgrupo_menu = $3 RETURNING idgrupo_menu, fecha_creado, creado_por, nombre, orden, activo`, [nombre, req.body?.activo !== false, Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Grupo de menú no encontrado' });
    res.json({ item: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un grupo con ese nombre' });
    next(error);
  }
});

export default router;
