import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, id } from '../services/pedidos.js';
import { validRange } from '../services/kpi-gastos.js';
import { resumenDelivery, pagarDelivery, anularPagoDelivery, asignarEntregador, pagoDelivery, opcionesDelivery } from '../services/pagos-delivery.js';
import { renderPagoDeliveryTicket } from '../services/pago-delivery-ticket.js';
import { renderPagosDeliveryPdf } from '../services/pagos-delivery-pdf.js';
import { renderPagosDeliveryXlsx } from '../services/pagos-delivery-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

// Caja y finanzas · Pagos a delivery: cuánto se le debe a cada entregador, pagos (salen de caja) y anulaciones.
const router = Router();
const route = fn => async (req, res, next) => { try { res.json(await fn(req)); } catch (error) { if (['P0001', '23514'].includes(error.code)) error.status = 400; if (error.code === '23505') { error.status = 409; error.message = 'Un pedido ya está incluido en otro pago activo'; } next(error); } };
const params = req => {
  const { inicio, fin } = req.query, entregador = String(req.query.entregador || '');
  if (!validRange(inicio, fin) || (entregador && !/^[1-9][0-9]{0,8}$/.test(entregador))) return null;
  return { inicio, fin, entregador: entregador ? Number(entregador) : null };
};
const invalid = res => res.status(400).json({ error: 'Ingresá un rango de fechas válido' });
const fileName = (p, ext) => `pagos-delivery-${p.inicio}_${p.fin}${p.entregador ? `-entregador${p.entregador}` : ''}.${ext}`;

router.get('/opciones', route(() => opcionesDelivery()));
router.get('/', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try { res.json(await resumenDelivery(p.inicio, p.fin, { entregador: p.entregador })); } catch (error) { next(error); }
});
router.post('/pagar', route(req => operation(req, c => pagarDelivery(c, req.body, req.user))));
router.post('/pedidos/:id/entregador', route(req => operation(req, c => asignarEntregador(c, req.params.id, req.body, req.user))));
router.post('/:id/anular', route(req => operation(req, c => anularPagoDelivery(c, req.params.id, req.body, req.user))));
router.get('/:id/ticket.pdf', async (req, res, next) => {
  try {
    const pago = await pagoDelivery(pool, id(req.params.id));
    sendPdf(res, await renderPagoDeliveryTicket({ pago, restaurante: await restaurantInfo(pool) }), `pago-delivery-${pago.idpago_delivery}.pdf`);
  } catch (error) { next(error); }
});
router.get('/reporte.pdf', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try { sendPdf(res, await renderPagosDeliveryPdf(await resumenDelivery(p.inicio, p.fin, { entregador: p.entregador }), await restaurantInfo(pool)), fileName(p, 'pdf')); }
  catch (error) { next(error); }
});
router.get('/reporte.xlsx', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const file = await renderPagosDeliveryXlsx(await resumenDelivery(p.inicio, p.fin, { entregador: p.entregador }), await restaurantInfo(pool));
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName(p, 'xlsx')}"`, 'Cache-Control': 'no-store', 'Content-Length': String(file.length) });
    res.send(file);
  } catch (error) { next(error); }
});
export default router;
