import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { auditar, cambios, numeros } from '../services/auditoria.js';

const router = Router();
router.use(requireAuth);

const MAX_ID = 2147483647;
const MAX_AMOUNT = 99999999999999; // numeric(14,0)
const numericFields = ['stock_actual', 'stock_minimo', 'precio_compra', 'precio_venta'];
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const validId = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_ID;

const validate = (body) => {
  const values = {
    nombre: String(body?.nombre || '').trim(),
    fk_idunidad_medida: Number(body?.fk_idunidad_medida),
    ...Object.fromEntries(numericFields.map((key) => [key, Number(body?.[key] ?? 0)])),
    activo: body?.activo !== false
  };
  if (!values.nombre) return 'El nombre es obligatorio';
  if (values.nombre.length > 120) return 'El nombre no puede superar los 120 caracteres';
  if (!validId(values.fk_idunidad_medida)) return 'La unidad de medida es obligatoria';
  if (!numericFields.every((key) => Number.isInteger(values[key]) && values[key] >= 0 && values[key] <= MAX_AMOUNT)) return 'Stock y precios deben ser enteros no negativos de hasta 14 dígitos';
  return values;
};

const selectSupply = `SELECT i.idinsumo, i.fecha_creado, i.creado_por, i.nombre, i.fk_idunidad_medida,
  i.stock_actual, i.stock_minimo, i.precio_compra, i.precio_venta, i.activo,
  u.codigo AS unidad_codigo, u.nombre AS unidad_nombre
  FROM insumo i JOIN unidad_medida u ON u.idunidad_medida = i.fk_idunidad_medida`;

const handleError = (error, res, next) => {
  if (error.code === '23503') return res.status(400).json({ error: 'La unidad de medida no existe' });
  if (error.code === '23505') return res.status(409).json({ error: 'Ya existe ese insumo' });
  next(error);
};

router.get('/', async (req, res, next) => {
  try {
    const page = Math.max(1, Math.trunc(Number(req.query.page)) || 1);
    const pageSize = pageSizeValue(req.query.pageSize);
    // soloActivos=true: para el buscador del producto, así los inactivos no ocupan lugar en la página.
    const filters = [`%${String(req.query.search || '').trim()}%`, req.query.soloActivos === 'true'];
    const where = 'WHERE (i.nombre ILIKE $1 OR u.nombre ILIKE $1 OR u.codigo ILIKE $1) AND (NOT $2::boolean OR i.activo)';
    const [list, count] = await Promise.all([
      pool.query(`${selectSupply} ${where} ORDER BY i.nombre, i.idinsumo LIMIT $3 OFFSET $4`, [...filters, pageSize, (page - 1) * pageSize]),
      pool.query(`SELECT count(*)::int AS total FROM insumo i JOIN unidad_medida u ON u.idunidad_medida = i.fk_idunidad_medida ${where}`, filters)
    ]);
    const total = count.rows[0].total;
    res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', requireCurrentForm, async (req, res, next) => {
  try {
    const values = validate(req.body);
    if (typeof values === 'string') return res.status(400).json({ error: values });
    const { rows } = await pool.query(`INSERT INTO insumo (nombre, fk_idunidad_medida, stock_actual, stock_minimo, precio_compra, precio_venta, activo, creado_por)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING idinsumo`,
    [values.nombre, values.fk_idunidad_medida, values.stock_actual, values.stock_minimo, values.precio_compra, values.precio_venta, values.activo, req.user.login]);
    const created = await pool.query(`${selectSupply} WHERE i.idinsumo = $1`, [rows[0].idinsumo]);
    res.status(201).json({ item: created.rows[0] });
  } catch (error) { handleError(error, res, next); }
});

// Precio y stock cambiados a mano quedan en la auditoría, en la misma transacción que el cambio.
router.put('/:id', requireCurrentForm, async (req, res, next) => {
  const values = validate(req.body);
  if (typeof values === 'string') return res.status(400).json({ error: values });
  const id = Number(req.params.id);
  if (!validId(id)) return res.status(404).json({ error: 'Insumo no encontrado' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query('SELECT nombre, stock_actual, precio_compra, precio_venta FROM insumo WHERE idinsumo = $1 FOR UPDATE', [id])).rows[0];
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Insumo no encontrado' }); }
    await client.query(`UPDATE insumo SET nombre = $1, fk_idunidad_medida = $2, stock_actual = $3, stock_minimo = $4,
      precio_compra = $5, precio_venta = $6, activo = $7 WHERE idinsumo = $8`,
    [values.nombre, values.fk_idunidad_medida, values.stock_actual, values.stock_minimo, values.precio_compra, values.precio_venta, values.activo, id]);
    const diff = cambios(before, values, ['precio_compra', 'precio_venta', 'stock_actual']);
    if (diff) await auditar(client, req.user, { accion: 'INSUMO_MODIFICADO', entidad: 'insumo', id,
      antes: { insumo: before.nombre, ...numeros(diff.antes) }, despues: numeros(diff.despues) });
    const updated = await client.query(`${selectSupply} WHERE i.idinsumo = $1`, [id]);
    await client.query('COMMIT');
    res.json({ item: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    handleError(error, res, next);
  } finally { client.release(); }
});

export default router;
