import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireCurrentForm);

const validPageSize = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const selectItem = `
  SELECT u.idubicacion_mesa, u.fecha_creado, u.creado_por, u.nombre, u.orden, u.activo,
         count(m.idmesa)::int AS cantidad_mesas
  FROM ubicacion_mesa u
  LEFT JOIN mesa m ON m.fk_idubicacion_mesa = u.idubicacion_mesa`;

router.get('/opciones', async (req, res, next) => {
  try {
    const incluirInactivas = req.query.incluirInactivas === 'true';
    const { rows } = await pool.query(`
      SELECT idubicacion_mesa, nombre, activo
      FROM ubicacion_mesa
      WHERE activo OR $1::boolean
      ORDER BY orden, nombre, idubicacion_mesa`, [incluirInactivas]);
    res.json({ items: rows });
  } catch (error) { next(error); }
});

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = validPageSize(req.query.pageSize);
    const offset = (page - 1) * pageSize;
    const pattern = `%${search}%`;
    const [itemsResult, countResult] = await Promise.all([
      pool.query(`${selectItem}
        WHERE u.nombre ILIKE $1
        GROUP BY u.idubicacion_mesa
        ORDER BY u.orden, u.nombre, u.idubicacion_mesa
        LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]),
      pool.query('SELECT count(*)::int AS total FROM ubicacion_mesa WHERE nombre ILIKE $1', [pattern])
    ]);
    const total = countResult.rows[0].total;
    res.json({ items: itemsResult.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (nombre.length > 80) return res.status(400).json({ error: 'El nombre admite hasta 80 caracteres' });
    const { rows } = await pool.query(`
      WITH creada AS (
        INSERT INTO ubicacion_mesa (nombre, orden, activo, creado_por)
        SELECT $1, (COALESCE(max(orden), 0) + 1)::smallint, $2, $3
        FROM ubicacion_mesa
        RETURNING *
      )
      SELECT creada.*, 0::int AS cantidad_mesas FROM creada`, [nombre, req.body?.activo !== false, req.user.login]);
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });
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
      SELECT idubicacion_mesa, orden
      FROM ubicacion_mesa
      ORDER BY orden, nombre, idubicacion_mesa
      FOR UPDATE`);
    const index = rows.findIndex((item) => item.idubicacion_mesa === id);
    if (index < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ubicación no encontrada' }); }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= rows.length) { await client.query('COMMIT'); return res.json({ moved: false }); }
    const current = rows[index];
    const neighbor = rows[neighborIndex];
    await client.query(`
      UPDATE ubicacion_mesa
      SET orden = CASE idubicacion_mesa
        WHEN $1::integer THEN $2::smallint
        WHEN $3::integer THEN $4::smallint
      END
      WHERE idubicacion_mesa IN ($1::integer, $3::integer)`, [current.idubicacion_mesa, neighbor.orden, neighbor.idubicacion_mesa, current.orden]);
    await client.query('COMMIT');
    res.json({ moved: true });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

router.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const nombre = String(req.body?.nombre || '').trim();
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido' });
    if (!nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (nombre.length > 80) return res.status(400).json({ error: 'El nombre admite hasta 80 caracteres' });
    const activo = req.body?.activo !== false;
    await client.query('BEGIN');
    const currentResult = await client.query('SELECT activo FROM ubicacion_mesa WHERE idubicacion_mesa = $1 FOR UPDATE', [id]);
    if (!currentResult.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Ubicación no encontrada' }); }
    const stateChanged = currentResult.rows[0].activo !== activo;
    await client.query('UPDATE ubicacion_mesa SET nombre = $1, activo = $2 WHERE idubicacion_mesa = $3', [nombre, activo, id]);
    if (stateChanged) await client.query('UPDATE mesa SET activa = $1 WHERE fk_idubicacion_mesa = $2', [activo, id]);
    const { rows } = await client.query(`${selectItem}
      WHERE u.idubicacion_mesa = $1
      GROUP BY u.idubicacion_mesa`, [id]);
    await client.query('COMMIT');
    res.json({ item: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una ubicación con ese nombre' });
    next(error);
  } finally { client.release(); }
});

export default router;
