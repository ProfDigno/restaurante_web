export function notFound(req, res) {
  res.status(404).json({ error: 'Recurso no encontrado' });
}

export function errorHandler(error, req, res, next) {
  if (!error.status || error.status >= 500) console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({ error: error.message || 'Error interno del servidor' });
}
