// Rechaza escrituras que llegan desde otro origen (defensa CSRF adicional a sameSite).
export function sameOriginWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch { /* origen inválido */ }
  return res.status(403).json({ error: 'Origen no permitido' });
}

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();

const keyOf = (req) => `${req.ip}|${String(req.body?.login || '').toLowerCase()}`;

export function loginRateLimit(req, res, next) {
  const entry = attempts.get(keyOf(req));
  if (entry && entry.until > Date.now() && entry.count >= MAX_ATTEMPTS) {
    res.set('Retry-After', String(Math.ceil((entry.until - Date.now()) / 1000)));
    return res.status(429).json({ error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo' });
  }
  next();
}

export function recordLoginFailure(req) {
  const key = keyOf(req);
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.until <= now) attempts.set(key, { count: 1, until: now + WINDOW_MS });
  else entry.count += 1;
}

export function clearLoginFailures(req) {
  attempts.delete(keyOf(req));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
}, WINDOW_MS).unref();
