import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;

// Valida los datos del entregador. El usuario es opcional: sin usuario el entregador no tiene acceso.
// La contraseña es un PIN de 4 números; vacío al editar conserva el actual. Nunca se devuelve ni el PIN ni su hash.
const validate = (body) => {
  const values = {
    nombre_completo: String(body?.nombre_completo || '').trim(),
    telefono: String(body?.telefono || '').trim() || null,
    activo: body?.activo !== false,
    usuario: String(body?.usuario || '').trim().toUpperCase() || null, // el usuario del entregador siempre en mayúsculas
    password: String(body?.password || '')
  };
  if (!values.nombre_completo) return 'El nombre completo es obligatorio';
  if (values.usuario && (values.usuario.length > 50 || /\s/.test(values.usuario))) return 'El usuario no puede tener espacios ni más de 50 caracteres';
  if (values.password && !/^\d{4}$/.test(values.password)) return 'El PIN debe tener exactamente 4 números';
  return values;
};

const select = `SELECT identregador_delivery, fecha_creado, creado_por, nombre_completo, telefono, activo,
  usuario, (password_hash IS NOT NULL) AS tiene_acceso FROM entregador_delivery`;

// El usuario del entregador no puede repetirse entre entregadores ni coincidir con un usuario del sistema.
async function checkUsuario(client, usuario, id) {
  if (!usuario) return null;
  const { rows } = await client.query(`
    SELECT 'entregador' AS origen FROM entregador_delivery WHERE lower(usuario)=lower($1) AND identregador_delivery IS DISTINCT FROM $2
    UNION ALL SELECT 'sistema' FROM usuario WHERE lower(login)=lower($1) LIMIT 1`, [usuario, id]);
  if (!rows.length) return null;
  return rows[0].origen === 'sistema' ? 'Ese usuario ya existe como usuario del sistema' : 'Ese usuario ya está asignado a otro entregador';
}

async function passwordHash(values, current) {
  if (!values.usuario) return null; // sin usuario se quita el acceso
  if (values.password) return bcrypt.hash(values.password, 12);
  return current;
}

const usuarioError = (error, res, next) => error.code === '23505'
  ? res.status(409).json({ error: 'Ese usuario ya está asignado a otro entregador' })
  : next(error);

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = pageSizeValue(req.query.pageSize);
    const pattern = `%${search}%`;
    const offset = (page - 1) * pageSize;
    const where = `WHERE nombre_completo ILIKE $1 OR COALESCE(telefono, '') ILIKE $1 OR COALESCE(usuario, '') ILIKE $1`;
    const [list, count] = await Promise.all([
      pool.query(`${select} ${where} ORDER BY nombre_completo, identregador_delivery LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]),
      pool.query(`SELECT count(*)::int AS total FROM entregador_delivery ${where}`, [pattern])
    ]);
    const total = count.rows[0].total;
    res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', requireCurrentForm, async (req, res, next) => {
  try {
    const values = validate(req.body);
    if (typeof values === 'string') return res.status(400).json({ error: values });
    if (values.usuario && !values.password) return res.status(400).json({ error: 'Ingresá el PIN del entregador' });
    const taken = await checkUsuario(pool, values.usuario, null);
    if (taken) return res.status(409).json({ error: taken });
    const hash = await passwordHash(values, null);
    const { rows } = await pool.query(`INSERT INTO entregador_delivery (nombre_completo, telefono, activo, usuario, password_hash, creado_por)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING identregador_delivery`,
      [values.nombre_completo, values.telefono, values.activo, values.usuario, hash, req.user.login]);
    const created = await pool.query(`${select} WHERE identregador_delivery = $1`, [rows[0].identregador_delivery]);
    res.status(201).json({ item: created.rows[0] });
  } catch (error) { usuarioError(error, res, next); }
});

router.put('/:id', requireCurrentForm, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const values = validate(req.body);
    if (typeof values === 'string') return res.status(400).json({ error: values });
    const current = await pool.query('SELECT password_hash FROM entregador_delivery WHERE identregador_delivery=$1', [id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Entregador no encontrado' });
    if (values.usuario && !values.password && !current.rows[0].password_hash) return res.status(400).json({ error: 'Ingresá el PIN del entregador' });
    const taken = await checkUsuario(pool, values.usuario, id);
    if (taken) return res.status(409).json({ error: taken });
    const hash = await passwordHash(values, current.rows[0].password_hash);
    await pool.query(`UPDATE entregador_delivery SET nombre_completo=$1, telefono=$2, activo=$3, usuario=$4, password_hash=$5
      WHERE identregador_delivery=$6`, [values.nombre_completo, values.telefono, values.activo, values.usuario, hash, id]);
    const updated = await pool.query(`${select} WHERE identregador_delivery = $1`, [id]);
    res.json({ item: updated.rows[0] });
  } catch (error) { usuarioError(error, res, next); }
});

export default router;
