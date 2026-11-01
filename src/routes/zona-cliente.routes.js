import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const validate = (body) => {
  const values = { codigo: String(body?.codigo || '').trim(), nombre: String(body?.nombre || '').trim(), precio_delivery: body?.precio_delivery === '' || body?.precio_delivery == null ? 0 : Number(body.precio_delivery), activo: body?.activo !== false };
  if (!values.codigo || !values.nombre) return 'Código y nombre son obligatorios';
  if (!Number.isInteger(values.precio_delivery) || values.precio_delivery < 0) return 'El precio de delivery debe ser un entero mayor o igual a cero';
  return values;
};
router.get('/', async (req, res, next) => { try { const search = String(req.query.search || '').trim(); const page = Math.max(1, Number(req.query.page) || 1); const pageSize = pageSizeValue(req.query.pageSize); const pattern = `%${search}%`; const offset = (page - 1) * pageSize; const [list, count] = await Promise.all([pool.query(`SELECT idzona_cliente, fecha_creado, creado_por, codigo, nombre, precio_delivery, activo FROM zona_cliente WHERE codigo ILIKE $1 OR nombre ILIKE $1 ORDER BY nombre, idzona_cliente LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]), pool.query(`SELECT count(*)::int AS total FROM zona_cliente WHERE codigo ILIKE $1 OR nombre ILIKE $1`, [pattern])]); const total = count.rows[0].total; res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) }); } catch (error) { next(error); } });
router.post('/', requireCurrentForm, async (req, res, next) => { try { const values = validate(req.body); if (typeof values === 'string') return res.status(400).json({ error: values }); const { rows } = await pool.query(`INSERT INTO zona_cliente (codigo, nombre, precio_delivery, activo, creado_por) VALUES ($1, $2, $3, $4, $5) RETURNING idzona_cliente, fecha_creado, creado_por, codigo, nombre, precio_delivery, activo`, [values.codigo, values.nombre, values.precio_delivery, values.activo, req.user.login]); res.status(201).json({ item: rows[0] }); } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una zona con ese código o nombre' }); next(error); } });
router.put('/:id', requireCurrentForm, async (req, res, next) => { try { const values = validate(req.body); if (typeof values === 'string') return res.status(400).json({ error: values }); const { rows } = await pool.query(`UPDATE zona_cliente SET codigo = $1, nombre = $2, precio_delivery = $3, activo = $4 WHERE idzona_cliente = $5 RETURNING idzona_cliente, fecha_creado, creado_por, codigo, nombre, precio_delivery, activo`, [values.codigo, values.nombre, values.precio_delivery, values.activo, Number(req.params.id)]); if (!rows.length) return res.status(404).json({ error: 'Zona de cliente no encontrada' }); res.json({ item: rows[0] }); } catch (error) { if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una zona con ese código o nombre' }); next(error); } });
export default router;
