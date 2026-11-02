import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const validate = (body) => {
  const values = {
    nombre_completo: String(body?.nombre_completo || '').trim(), razon_social: String(body?.razon_social || '').trim() || null,
    ruc: String(body?.ruc || '').trim() || null, direccion: String(body?.direccion || '').trim() || null,
    telefono: String(body?.telefono || '').trim() || null, email: String(body?.email || '').trim() || null,
    notas: String(body?.notas || '').trim() || null, fk_idzona_cliente: body?.fk_idzona_cliente === '' || body?.fk_idzona_cliente == null ? null : Number(body.fk_idzona_cliente), activo: body?.activo !== false,
    es_ocacional: body?.es_ocacional === true
  };
  if (!values.nombre_completo) return 'El nombre completo es obligatorio';
  if (!values.ruc) return 'El RUC es obligatorio';
  if (!values.direccion) return 'La dirección es obligatoria';
  if (!values.telefono) return 'El teléfono es obligatorio';
  if (values.fk_idzona_cliente === null) return 'La zona de cliente es obligatoria';
  if (values.email && !emailPattern.test(values.email)) return 'El email no tiene un formato válido';
  if (values.fk_idzona_cliente !== null && !Number.isInteger(values.fk_idzona_cliente)) return 'La zona seleccionada no es válida';
  return values;
};
const selectClient = `SELECT c.idcliente, c.fecha_creado, c.creado_por, c.nombre_completo, c.razon_social, c.ruc, c.direccion, c.telefono, c.email, c.notas, c.fk_idzona_cliente, c.activo, c.es_ocacional, z.codigo AS zona_codigo, z.nombre AS zona_nombre, z.precio_delivery FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente = c.fk_idzona_cliente`;

const clientWriteError = (error, res, next) => {
  if (error.code === '23503') return res.status(400).json({ error: 'La zona seleccionada no existe' });
  if (error.code === '23505') {
    if (error.constraint === 'cliente_telefono_normalizado_unico') return res.status(409).json({ error: 'Ya existe un cliente con ese teléfono' });
    if (error.constraint === 'cliente_un_ocacional') return res.status(409).json({ error: 'Ya existe otro cliente ocasional' });
    return res.status(409).json({ error: 'Ya existe un cliente con ese RUC' });
  }
  return next(error);
};

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim(); const page = Math.max(1, Number(req.query.page) || 1); const pageSize = pageSizeValue(req.query.pageSize); const pattern = `%${search}%`; const offset = (page - 1) * pageSize;
    const where = `WHERE c.nombre_completo ILIKE $1 OR COALESCE(c.razon_social, '') ILIKE $1 OR COALESCE(c.ruc, '') ILIKE $1 OR COALESCE(c.telefono, '') ILIKE $1 OR COALESCE(z.nombre, '') ILIKE $1 OR COALESCE(z.codigo, '') ILIKE $1`;
    const [list, count] = await Promise.all([pool.query(`${selectClient} ${where} ORDER BY c.nombre_completo, c.idcliente LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]), pool.query(`SELECT count(*)::int AS total FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente = c.fk_idzona_cliente ${where}`, [pattern])]);
    const total = count.rows[0].total; res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const found = await pool.query(`${selectClient} WHERE c.idcliente = $1`, [Number(req.params.id)]);
    if (!found.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    res.json({ item: found.rows[0] });
  } catch (error) { next(error); }
});

router.get('/consulta-ruc', async (req, res, next) => {
  try {
    const ruc = String(req.query.ruc || '').trim();
    if (!/^\d{1,8}(?:-\d)?$/.test(ruc)) return res.status(400).json({ error: 'Ingresá un RUC válido, por ejemplo 80012345-5' });
    const response = await fetch(`https://turuc.com.py/api/contribuyente/${encodeURIComponent(ruc)}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.data) return res.status(404).json({ error: payload.message || 'No se encontró información para ese RUC' });
    res.json({ item: { ruc: payload.data.ruc || ruc, razon_social: payload.data.razonSocial || '', estado: payload.data.estado || 'DESCONOCIDO' } });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return res.status(504).json({ error: 'La consulta de RUC tardó demasiado. Intentá nuevamente.' });
    next(error);
  }
});

router.post('/', requireCurrentForm, async (req, res, next) => {
  const values = validate(req.body);
  if (typeof values === 'string') return res.status(400).json({ error: values });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (values.es_ocacional) {
      await client.query('SELECT pg_advisory_xact_lock(20261013)');
      await client.query('UPDATE cliente SET es_ocacional = false WHERE es_ocacional');
    }
    const { rows } = await client.query(`INSERT INTO cliente (nombre_completo, razon_social, ruc, direccion, telefono, email, notas, fk_idzona_cliente, activo, es_ocacional, creado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING idcliente`, [values.nombre_completo, values.razon_social, values.ruc, values.direccion, values.telefono, values.email, values.notas, values.fk_idzona_cliente, values.activo, values.es_ocacional, req.user.login]);
    const created = await client.query(`${selectClient} WHERE c.idcliente = $1`, [rows[0].idcliente]);
    await client.query('COMMIT');
    res.status(201).json({ item: created.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    clientWriteError(error, res, next);
  } finally { client.release(); }
});

router.put('/:id', requireCurrentForm, async (req, res, next) => {
  const values = validate(req.body);
  if (typeof values === 'string') return res.status(400).json({ error: values });
  const id = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exists = await client.query('SELECT idcliente FROM cliente WHERE idcliente = $1 FOR UPDATE', [id]);
    if (!exists.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    if (values.es_ocacional) {
      await client.query('SELECT pg_advisory_xact_lock(20261013)');
      await client.query('UPDATE cliente SET es_ocacional = false WHERE es_ocacional AND idcliente <> $1', [id]);
    }
    await client.query(`UPDATE cliente SET nombre_completo=$1, razon_social=$2, ruc=$3, direccion=$4, telefono=$5, email=$6, notas=$7, fk_idzona_cliente=$8, activo=$9, es_ocacional=$10 WHERE idcliente=$11`, [values.nombre_completo, values.razon_social, values.ruc, values.direccion, values.telefono, values.email, values.notas, values.fk_idzona_cliente, values.activo, values.es_ocacional, id]);
    const updated = await client.query(`${selectClient} WHERE c.idcliente = $1`, [id]);
    await client.query('COMMIT');
    res.json({ item: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    clientWriteError(error, res, next);
  } finally { client.release(); }
});

export default router;
