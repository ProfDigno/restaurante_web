import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, id } from '../services/pedidos.js';
import { validRange } from '../services/kpi-gastos.js';
import { resumenDelivery, pagarDelivery, anularPagoDelivery, asignarEntregador, pagoDelivery, opcionesDelivery } from '../services/pagos-delivery.js';
import { renderPagoDeliveryTicket, renderRendicionTicket } from '../services/pago-delivery-ticket.js';
import { resumenRendiciones, pendientesRendicion, rendirDelivery, anularRendicion, rendicionDelivery, listaRendiciones } from '../services/rendicion-delivery.js';
import { renderPagosDeliveryPdf } from '../services/pagos-delivery-pdf.js';
import { renderPagosDeliveryXlsx } from '../services/pagos-delivery-xlsx.js';
import { restaurantInfo, sendPdf, ticketRoute } from '../services/ticket-pdf.js';

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
// Rendición del entregador (fin del turno): cobra sus pedidos y le paga el delivery en una sola operación.
router.get('/rendicion', route(async () => ({ entregadores: await resumenRendiciones() })));
router.get('/rendicion/:entregador', route(req => pendientesRendicion(pool, req.params.entregador)));
router.post('/rendir', route(req => operation(req, c => rendirDelivery(c, req.body, req.user))));
router.get('/rendiciones', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try { res.json({ items: await listaRendiciones(p.inicio, p.fin, p.entregador) }); } catch (error) { next(error); }
});
router.post('/rendiciones/:id/anular', route(req => operation(req, c => anularRendicion(c, req.params.id, req.body, req.user))));
ticketRoute(router, '/rendiciones/:id/ticket.pdf', async (req, res, next) => {
  try {
    const rendicion = await rendicionDelivery(pool, id(req.params.id));
    await sendPdf(res, await renderRendicionTicket({ rendicion, restaurante: await restaurantInfo(pool) }), `rendicion-delivery-${rendicion.idrendicion_delivery}.pdf`);
  } catch (error) { next(error); }
});
router.post('/:id/anular', route(req => operation(req, c => anularPagoDelivery(c, req.params.id, req.body, req.user))));
ticketRoute(router,'/:id/ticket.pdf', async (req, res, next) => {
  try {
    const pago = await pagoDelivery(pool, id(req.params.id));
    await sendPdf(res, await renderPagoDeliveryTicket({ pago, restaurante: await restaurantInfo(pool) }), `pago-delivery-${pago.idpago_delivery}.pdf`);
  } catch (error) { next(error); }
});
router.get('/reporte.pdf', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try { await sendPdf(res, await renderPagosDeliveryPdf(await resumenDelivery(p.inicio, p.fin, { entregador: p.entregador }), await restaurantInfo(pool)), fileName(p, 'pdf')); }
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
