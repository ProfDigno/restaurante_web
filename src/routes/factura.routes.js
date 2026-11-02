import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail } from '../services/pedidos.js';
import * as sisfe from '../services/sisfe.js';
import {
  cancelarFactura, confirmarFactura, crearFactura, digitoVerificador, emitirBorrador, facturaDelPedido, kudeDe,
  obtenerFactura, partesRuc, precargarDesdePedido, refrescarEstado
} from '../services/factura.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) {
    if (error.code === '23505') { error.status = 409; error.message = 'El pedido ya tiene una factura o el número está repetido'; }
    else if (['P0001', '23514', '23503'].includes(error.code)) error.status = 400;
    next(error);
  }
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const ESTADOS = ['pendiente', 'borrador', 'enviado', 'aprobado', 'rechazado', 'cancelado', 'error'];
const numeroCompleto = "f.establecimiento || '-' || f.punto || '-' || lpad(f.numero::text, 7, '0')";

router.get('/', route(async req => {
  const page = integer(req.query.page || 1, 'Página', 1);
  const size = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const { inicio, fin } = req.query;
  const estado = String(req.query.estado || '');
  if (estado && !ESTADOS.includes(estado)) fail('Estado inválido');
  if ((inicio && !validDate(inicio)) || (fin && !validDate(fin)) || (inicio && fin && inicio > fin)) fail('Rango de fechas inválido');
  const params = [`%${String(req.query.search || '').trim()}%`, estado, inicio || null, fin || null];
  const where = `WHERE (f.cliente_razon_social ILIKE $1 OR COALESCE(f.cliente_ruc,'') ILIKE $1 OR ${numeroCompleto} ILIKE $1)
    AND ($2::text = '' OR f.estado = $2) AND ($3::date IS NULL OR f.fecha_emision >= $3::date)
    AND ($4::date IS NULL OR f.fecha_emision < $4::date + INTERVAL '1 day')`;
  const total = (await pool.query(`SELECT count(*)::int AS total FROM factura f ${where}`, params)).rows[0].total;
  const items = (await pool.query(`SELECT f.idfactura, f.fk_idpedido, ${numeroCompleto} AS numero_completo, f.fecha_emision, f.cliente_razon_social,
    f.cliente_ruc, f.total, f.estado, f.cdc, f.respuesta_mensaje FROM factura f ${where}
    ORDER BY f.idfactura DESC LIMIT $5 OFFSET $6`, [...params, size, (page - 1) * size])).rows;
  return { items, total, page, pageSize: size, totalPages: Math.max(1, Math.ceil(total / size)) };
}));

router.get('/clientes', route(async req => {
  const search = `%${String(req.query.search || '').trim()}%`;
  return { items: (await pool.query(`SELECT idcliente, nombre_completo, razon_social, ruc, direccion, email, telefono FROM cliente
    WHERE activo AND (nombre_completo ILIKE $1 OR razon_social ILIKE $1 OR ruc ILIKE $1 OR telefono ILIKE $1)
    ORDER BY nombre_completo, idcliente LIMIT 50`, [search])).rows };
}));

// Verifica el RUC: primero el dígito verificador (local) y después la existencia en SIFEN.
router.get('/ruc/:ruc', route(async req => {
  const parts = partesRuc(req.params.ruc);
  if (!parts) fail('RUC inválido: usá el formato 1234567-8');
  const dv = digitoVerificador(parts.base);
  if (parts.dv !== null && parts.dv !== dv) return { encontrado: false, dv_correcto: false, dv_esperado: dv, mensaje: `El dígito verificador no coincide (debería ser ${dv})` };
  return { dv_correcto: true, ruc_completo: `${parts.base}-${dv}`, ...await sisfe.consultarRuc(parts.base) };
}));

router.get('/desde-pedido/:pedidoId', route(async req => {
  const pedidoId = id(req.params.pedidoId);
  const existente = await facturaDelPedido(pool, pedidoId);
  return existente ? { existente: true, factura: existente } : { existente: false, borrador: await precargarDesdePedido(pool, pedidoId) };
}));

router.get('/:id/kude.pdf', async (req, res, next) => {
  try {
    const { factura, pdf } = await kudeDe(id(req.params.id));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="factura-${factura.numero_completo}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (error) { next(error); }
});

router.get('/:id', route(req => obtenerFactura(pool, req.params.id)));

router.post('/', route(async req => {
  const { idfactura } = await operation(req, c => crearFactura(c, req.body, req.user));
  return emitirBorrador(idfactura);
}));
router.post('/:id/reintentar', route(req => emitirBorrador(id(req.params.id))));
router.post('/:id/confirmar', route(req => confirmarFactura(id(req.params.id))));
router.post('/:id/estado', route(req => refrescarEstado(id(req.params.id), req.user)));
router.post('/:id/cancelar', route(req => cancelarFactura(id(req.params.id), req.body?.motivo, req.user)));

export default router;
