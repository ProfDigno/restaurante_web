import { writer, renderTicket, money, dateTime, dateOnly, muted, danger, MARGIN } from './ticket-pdf.js';

// Comprobante de gasto en papel de 80 mm.
function layout(doc, { gasto, restaurante }, printedAt) {
  const { state, text, pair, rule, space, header, signature } = writer(doc);
  header(restaurante);
  text('COMPROBANTE DE GASTO', { size: 14, bold: true, align: 'center', gap: 1 });
  text(`GASTO #${gasto.idgasto} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  if (gasto.estado === 'anulado') text('*** ANULADO ***', { size: 13, bold: true, align: 'center', color: danger, gap: 4 });

  rule();
  pair('Fecha del gasto', dateOnly(gasto.fecha_gasto));
  pair('Tipo', gasto.tipo_nombre || '—');
  pair('Forma de pago', gasto.forma_pago_nombre || '—');
  space(2);
  text('Descripción', { size: 8, bold: true, gap: 1 });
  text(gasto.descripcion, { size: 8.5, gap: 4 });

  rule();
  pair('IMPORTE', money(gasto.total_gasto), { bold: true });

  rule();
  pair('Registrado por', gasto.creado_por || '—');
  pair('Registrado', dateTime(gasto.fecha_creado));
  if (gasto.estado === 'anulado') {
    pair('Anulado por', gasto.anulado_por || '—');
    pair('Anulado', dateTime(gasto.fecha_anulado));
    if (gasto.motivo_anulado) text(`Motivo: ${gasto.motivo_anulado}`, { size: 8, color: muted, gap: 3 });
  }
  pair('Impreso', dateTime(printedAt));
  signature('Firma / Recibí conforme');
  return state.y + MARGIN;
}

export function renderGastoTicket(data, printedAt = new Date()) {
  return renderTicket(layout, data, `Gasto #${data.gasto.idgasto}`, printedAt);
}
