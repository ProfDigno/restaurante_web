import { writer, renderTicket, money, dateTime, muted, danger } from './ticket-pdf.js';

// Comprobante de pago a delivery en papel de 58 u 80 mm, con el detalle de pedidos y la firma del entregador.
const isoText = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';

function layout(doc, { pago, restaurante }, printedAt) {
  const { state, text, pair, rule, space, header, signature, end } = writer(doc);
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
  return end();
}

export function renderPagoDeliveryTicket(data, printedAt = new Date()) {
  return renderTicket(layout, data, `Pago a delivery #${data.pago.idpago_delivery}`, printedAt);
}

// Rendición del entregador: cobros de cada pedido, delivery pagado y el neto que entrega (o recibe), con su firma.
function layoutRendicion(doc, { rendicion: r, restaurante }, printedAt) {
  const { text, pair, rule, space, header, signature, end } = writer(doc);
  header(restaurante);
  text('RENDICIÓN DE DELIVERY', { size: 13, bold: true, align: 'center', gap: 1 });
  text(`RENDICIÓN #${r.idrendicion_delivery} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  if (r.estado === 'anulada') text('*** ANULADA ***', { size: 13, bold: true, align: 'center', color: danger, gap: 4 });

  rule();
  pair('Fecha', dateTime(r.fecha_creado));
  pair('Entregador', r.entregador || '—');
  if (r.entregador_telefono) pair('Teléfono', r.entregador_telefono);
  space(2);
  text(`Pedidos (${r.pedidos.length})`, { size: 8, bold: true, gap: 2 });
  for (const item of r.pedidos) {
    pair(`#${item.idpedido} · ${item.cliente}`.slice(0, 40), money(item.total_pedido), { size: 7.5, leftRatio: .7, gap: 1 });
    const partes = [];
    if (item.cobrado_efectivo) partes.push(`Efectivo ${money(item.cobrado_efectivo)}`);
    if (item.cobrado_otros) partes.push(`${item.formas_cobro && !item.cobrado_efectivo ? item.formas_cobro : 'Otros'} ${money(item.cobrado_otros)}`);
    if (item.cobrado_antes) partes.push(`Pagado antes ${money(item.cobrado_antes)}`);
    partes.push(`Delivery ${money(item.delivery_pagado)}`);
    text(partes.join(' · '), { size: 6.5, color: muted, gap: 3, indent: 6 });
  }

  rule();
  pair('Efectivo cobrado', money(r.efectivo_cobrado));
  pair('Tarjeta / QR / otros', money(r.otros_cobrado));
  // Cierre del POS: resumen impreso de la máquina contra lo cobrado en el sistema.
  if (r.pos_informado !== null && r.pos_informado !== undefined) {
    const diferencia = r.pos_informado - r.pos_sistema;
    pair(`POS ${r.maquina_pos || ''}`.trim(), money(r.pos_informado));
    pair('Según sistema', money(r.pos_sistema));
    pair('Diferencia POS', diferencia === 0 ? 'Coincide' : `${diferencia > 0 ? '+' : '-'} ${money(Math.abs(diferencia))}`, { bold: diferencia !== 0 });
  }
  pair('Delivery del entregador', `- ${money(r.delivery_pagado)}`);
  rule();
  if (r.neto >= 0) pair('ENTREGA EL ENTREGADOR', money(r.neto), { bold: true });
  else pair('EL LOCAL LE PAGA', money(-r.neto), { bold: true });

  rule();
  pair('Registrado por', r.creado_por || '—');
  if (r.estado === 'anulada') {
    pair('Anulada por', r.anulado_por || '—');
    pair('Anulada', dateTime(r.fecha_anulado));
    if (r.motivo_anulado) text(`Motivo: ${r.motivo_anulado}`, { size: 8, color: muted, gap: 3 });
  }
  pair('Impreso', dateTime(printedAt));
  signature(`Conforme · ${r.entregador || ''}`);
  return end();
}

export function renderRendicionTicket(data, printedAt = new Date()) {
  return renderTicket(layoutRendicion, data, `Rendición de delivery #${data.rendicion.idrendicion_delivery}`, printedAt);
}
