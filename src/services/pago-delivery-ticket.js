import { writer, renderTicket, money, dateTime, muted, danger, MARGIN } from './ticket-pdf.js';

// Comprobante de pago a delivery en papel de 80 mm, con el detalle de pedidos y la firma del entregador.
const isoText = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';

function layout(doc, { pago, restaurante }, printedAt) {
  const { state, text, pair, rule, space, header, signature } = writer(doc);
  header(restaurante);
  text('PAGO A DELIVERY', { size: 14, bold: true, align: 'center', gap: 1 });
  text(`PAGO #${pago.idpago_delivery} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  if (pago.estado === 'anulado') text('*** ANULADO ***', { size: 13, bold: true, align: 'center', color: danger, gap: 4 });

  rule();
  pair('Fecha', dateTime(pago.fecha_creado));
  pair('Entregador', pago.entregador || '—');
  if (pago.entregador_telefono) pair('Teléfono', pago.entregador_telefono);
  pair('Período', `${isoText(pago.fecha_desde)} al ${isoText(pago.fecha_hasta)}`);
  pair('Forma de pago', pago.sin_caja ? 'Pagado fuera del sistema (no mueve caja)' : pago.forma_pago || '—');
  if (pago.observacion) text(`Obs.: ${pago.observacion}`, { size: 8, color: muted, gap: 3 });
  space(2);
  text(`Pedidos (${pago.pedidos.length})`, { size: 8, bold: true, gap: 2 });
  for (const item of pago.pedidos) pair(`#${item.idpedido} · ${isoText(item.fecha).slice(0, 5)} · ${item.cliente}`.slice(0, 40), money(item.monto_delivery), { size: 7.5, leftRatio: .7 });

  rule();
  pair('TOTAL PAGADO', money(pago.total), { bold: true });

  rule();
  pair('Registrado por', pago.creado_por || '—');
  if (pago.estado === 'anulado') {
    pair('Anulado por', pago.anulado_por || '—');
    pair('Anulado', dateTime(pago.fecha_anulado));
    if (pago.motivo_anulado) text(`Motivo: ${pago.motivo_anulado}`, { size: 8, color: muted, gap: 3 });
  }
  pair('Impreso', dateTime(printedAt));
  signature(`Recibí conforme · ${pago.entregador || ''}`);
  return state.y + MARGIN;
}

export function renderPagoDeliveryTicket(data, printedAt = new Date()) {
  return renderTicket(layout, data, `Pago a delivery #${data.pago.idpago_delivery}`, printedAt);
}
