import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { permissionCode } from '../config/menu.js';

const DEV_SECRET = 'desarrollo-restaurante-cambiar';
const PLACEHOLDER_SECRETS = ['cambiar-por-un-secreto-largo'];

export function assertSessionSecret() {
  if (process.env.NODE_ENV !== 'production') return;
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 32 || value === DEV_SECRET || PLACEHOLDER_SECRETS.includes(value)) {
    throw new Error('JWT_SECRET debe definirse con al menos 32 caracteres en producción');
  }
}

const secret = () => process.env.JWT_SECRET || DEV_SECRET;

export function signSession(user) {
  return jwt.sign({ sub: user.idusuario }, secret(), { expiresIn: '8h' });
}

export async function requireAuth(req, res, next) {
  if (req.user) return next();
  const token = req.cookies?.restaurante_token;
  if (!token) return res.status(401).json({ error: 'Sesión requerida' });
  try {
    const session = jwt.verify(token, secret());
    const { rows } = await pool.query(`
      SELECT u.idusuario AS sub, u.login, u.nombre, r.rol,
        COALESCE(array_agg(DISTINCT e.codigo_evento) FILTER (WHERE e.activo AND i.activo), '{}') AS permisos
      FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol AND r.activo
      LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol=r.idusuario_rol
      LEFT JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento
      WHERE u.idusuario=$1 AND u.activo
      GROUP BY u.idusuario,r.rol`, [session.sub]);
    if (!rows.length) return res.status(401).json({ error: 'Usuario o rol inactivo' });
    req.user = rows[0];
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Sesión expirada' });
    next(error);
  }
}

export function hasPermission(user, formId) {
  return user?.permisos?.includes(permissionCode(formId)) || false;
}

export function requirePermission(formId, readAlternatives = []) {
  return (req, res, next) => {
    const allowed = hasPermission(req.user, formId) ||
      (req.method === 'GET' && readAlternatives.some(id => hasPermission(req.user, id)));
    if (!allowed) return res.status(403).json({ error: 'No tenés permisos para esta operación' });
    next();
  };
}

// Las rutas internas consultan el permiso del formulario correspondiente.
const routeForms = {
  '/api/mesas': 'mesas', '/api/grupos-menu': 'grupos', '/api/categorias-menu': 'categorias',
  '/api/unidades-menu': 'unidades-menu', '/api/productos-menu': 'menu',
  '/api/zonas-clientes': 'zonas', '/api/clientes': 'clientes',
  '/api/entregadores-delivery': 'delivery', '/api/unidades-medida': 'unidades-medida',
  '/api/unidades-conversion': 'conversiones-unidad', '/api/ingredientes': 'ingredientes',
  '/api/mesas-config': 'mesas-config', '/api/ubicaciones-mesa': 'ubicaciones-mesa',
  '/api/pedidos': 'pedidos', '/api/formas-pago': 'formas-pago', '/api/cajas': 'caja',
  '/api/gasto-tipos': 'gasto-tipos', '/api/gastos': 'gastos',
  '/api/proveedores': 'proveedores', '/api/compras': 'compras',
  '/api/facturas': 'facturas', '/api/datos-restaurante': 'datos-restaurante',
  '/api/comanda-config': 'configuracion-comanda'
};
const routeReadAlternatives = {
  '/api/mesas': ['pedidos'],
  '/api/categorias-menu': ['menu'],
  '/api/grupos-menu': ['menu'],
  '/api/unidades-menu': ['menu'],
  '/api/ingredientes': ['menu'],
  '/api/unidades-medida': ['ingredientes', 'conversiones-unidad'],
  '/api/ubicaciones-mesa': ['mesas-config'],
  '/api/zonas-clientes': ['clientes', 'pedidos']
};
export function requireCurrentForm(req, res, next) {
  const formId = routeForms[req.baseUrl];
  if (formId && (hasPermission(req.user, formId) ||
    (req.baseUrl === '/api/clientes' && req.method === 'POST' && hasPermission(req.user, 'pedidos')) ||
    (req.method === 'GET' && routeReadAlternatives[req.baseUrl]?.some(id => hasPermission(req.user, id))))) return next();
  return res.status(403).json({ error: 'No tenés permisos para esta operación' });
}
