import jwt from 'jsonwebtoken';
import { pool } from '../config/database.js';
import { sessionSecret as secret } from './auth.js';

// Sesión del entregador (panel /delivery). Va en una cookie propia, separada de la del sistema:
// requireAuth solo lee restaurante_token, así que con esta sesión no se entra al sistema principal.
// El token lleva un fragmento del hash del PIN: si se cambia el PIN o se quita el usuario, la sesión cae sola.
export const DELIVERY_COOKIE = 'delivery_token';
const DURACION_MS = 12 * 60 * 60 * 1000;
const huella = hash => String(hash || '').slice(-12);

export function signDeliverySession(entregador) {
  return jwt.sign({ sub: entregador.identregador_delivery, tipo: 'delivery', h: huella(entregador.password_hash) }, secret(), { expiresIn: DURACION_MS / 1000 });
}

export function cookieOptions() {
  const secure = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: 'lax', secure, maxAge: DURACION_MS };
}

export async function requireDelivery(req, res, next) {
  const token = req.cookies?.[DELIVERY_COOKIE];
  if (!token) return res.status(401).json({ error: 'Sesión requerida' });
  try {
    const session = jwt.verify(token, secret());
    if (session.tipo !== 'delivery' || !Number.isSafeInteger(session.sub)) return res.status(401).json({ error: 'Sesión inválida' });
    const { rows } = await pool.query(`SELECT identregador_delivery, nombre_completo, usuario, password_hash
      FROM entregador_delivery WHERE identregador_delivery=$1 AND activo AND usuario IS NOT NULL`, [session.sub]);
    const entregador = rows[0];
    if (!entregador || huella(entregador.password_hash) !== session.h) return res.status(401).json({ error: 'Sesión expirada' });
    // Para la auditoría: sin idusuario del sistema; el login identifica al entregador.
    req.entregador = { id: entregador.identregador_delivery, nombre: entregador.nombre_completo, usuario: entregador.usuario };
    req.user = { sub: null, login: `delivery:${entregador.usuario}`, ip: req.ip };
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') return res.status(401).json({ error: 'Sesión expirada' });
    next(error);
  }
}
