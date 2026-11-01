import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const pageSize = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const selectMesa = `
  SELECT m.idmesa, m.fecha_creado, m.creado_por, m.numero, m.capacidad,
         m.fk_idubicacion_mesa, u.nombre AS ubicacion, u.activo AS ubicacion_activa,
         m.estado, m.activa
  FROM mesa m
  JOIN ubicacion_mesa u ON u.idubicacion_mesa = m.fk_idubicacion_mesa`;

function validate(body) {
  const value = {
    numero: Number(body?.numero),
    capacidad: Number(body?.capacidad),
    fk_idubicacion_mesa: Number(body?.fk_idubicacion_mesa),
    activa: body?.activa !== false
  };
  if (!Number.isInteger(value.numero) || value.numero <= 0) return 'El número debe ser un entero mayor que cero';
  if (!Number.isInteger(value.capacidad) || value.capacidad <= 0) return 'La capacidad debe ser un entero mayor que cero';
  if (!Number.isInteger(value.fk_idubicacion_mesa) || value.fk_idubicacion_mesa <= 0) return 'Seleccioná una ubicación válida';
  return value;
}

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = pageSize(req.query.pageSize);
    const pattern = `%${search}%`;
    const offset = (page - 1) * size;
    const [listResult, countResult] = await Promise.all([
      pool.query(`${selectMesa}
        WHERE CAST(m.numero AS text) ILIKE $1 OR u.nombre ILIKE $1
        ORDER BY m.numero LIMIT $2 OFFSET $3`, [pattern, size, offset]),
      pool.query(`SELECT count(*)::int AS total FROM mesa m
        JOIN ubicacion_mesa u ON u.idubicacion_mesa = m.fk_idubicacion_mesa
        WHERE CAST(m.numero AS text) ILIKE $1 OR u.nombre ILIKE $1`, [pattern])
    ]);
    const total = countResult.rows[0].total;
    res.json({ items: listResult.rows, total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) });
  } catch (error) { next(error); }
});

router.post('/', requireCurrentForm, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const value = validate(req.body);
    if (typeof value === 'string') return res.status(400).json({ error: value });
    await client.query('BEGIN');
    const locationResult = await client.query('SELECT activo FROM ubicacion_mesa WHERE idubicacion_mesa = $1 FOR SHARE', [value.fk_idubicacion_mesa]);
    if (!locationResult.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La ubicación seleccionada no existe' }); }
    if (value.activa && !locationResult.rows[0].activo) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No se puede activar una mesa en una ubicación inactiva' }); }
    const inserted = await client.query(`INSERT INTO mesa (numero, capacidad, fk_idubicacion_mesa, activa, creado_por)
      VALUES ($1, $2, $3, $4, $5) RETURNING idmesa`, [value.numero, value.capacidad, value.fk_idubicacion_mesa, value.activa, req.user.login]);
    const { rows } = await client.query(`${selectMesa} WHERE m.idmesa = $1`, [inserted.rows[0].idmesa]);
    await client.query('COMMIT');
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una mesa con ese número' });
    next(error);
  } finally { client.release(); }
});

router.put('/:id', requireCurrentForm, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const value = validate(req.body);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identificador inválido' });
    if (typeof value === 'string') return res.status(400).json({ error: value });
    await client.query('BEGIN');
    const locationResult = await client.query('SELECT activo FROM ubicacion_mesa WHERE idubicacion_mesa = $1 FOR SHARE', [value.fk_idubicacion_mesa]);
    if (!locationResult.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'La ubicación seleccionada no existe' }); }
    if (value.activa && !locationResult.rows[0].activo) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'No se puede activar una mesa en una ubicación inactiva' }); }
    const updated = await client.query(`UPDATE mesa
      SET numero = $1, capacidad = $2, fk_idubicacion_mesa = $3, activa = $4
      WHERE idmesa = $5 RETURNING idmesa`, [value.numero, value.capacidad, value.fk_idubicacion_mesa, value.activa, id]);
    if (!updated.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Mesa no encontrada' }); }
    const { rows } = await client.query(`${selectMesa} WHERE m.idmesa = $1`, [id]);
    await client.query('COMMIT');
    res.json({ item: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una mesa con ese número' });
    next(error);
  } finally { client.release(); }
});

export default router;
