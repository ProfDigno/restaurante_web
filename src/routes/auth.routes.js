import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { menuForPermissions } from '../config/menu.js';
import { requireAuth, signSession } from '../middleware/auth.js';
import { loginRateLimit, recordLoginFailure, clearLoginFailures } from '../middleware/security.js';

const router = Router();

router.post('/login', loginRateLimit, async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (!login || !password) return res.status(400).json({ error: 'Ingresá usuario y contraseña' });
    const { rows } = await pool.query(`
      SELECT u.idusuario, u.login, u.nombre, u.password_hash, r.rol,
        COALESCE(array_agg(DISTINCT e.codigo_evento) FILTER (WHERE e.activo AND i.activo), '{}') AS permisos
      FROM usuario u
      JOIN usuario_rol r ON r.idusuario_rol = u.fk_idusuario_rol AND r.activo
      LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol = r.idusuario_rol
      LEFT JOIN usuario_rol_evento e ON e.idusuario_rol_evento = i.fk_idusuario_rol_evento
      WHERE u.login = $1 AND u.activo
      GROUP BY u.idusuario, r.rol`, [login]);
    const user = rows[0];
    const valid = user && user.password_hash !== 'REEMPLAZAR_HASH' && await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordLoginFailure(req);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
    clearLoginFailures(req);
    const session = { ...user, permisos: user.permisos || [] };
    res.cookie('restaurante_token', signSession(session), { httpOnly: true, sameSite: 'lax', secure: cookieSecure(), maxAge: 8 * 60 * 60 * 1000 });
    res.json({ user: { idusuario: user.idusuario, login: user.login, nombre: user.nombre, rol: user.rol, permisos: user.permisos }, menu: menuForPermissions(user.permisos) });
  } catch (error) { next(error); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: { idusuario: req.user.sub, login: req.user.login, nombre: req.user.nombre, rol: req.user.rol, permisos: req.user.permisos }, menu: menuForPermissions(req.user.permisos) });
});

// COOKIE_SECURE=false permite servir en producción por HTTP (sin dominio/HTTPS todavía).
function cookieSecure() {
  if (process.env.COOKIE_SECURE) return process.env.COOKIE_SECURE === 'true';
  return process.env.NODE_ENV === 'production';
}

router.post('/logout', (req, res) => { res.clearCookie('restaurante_token'); res.status(204).end(); });

export default router;
