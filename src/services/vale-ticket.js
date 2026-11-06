import { writer, renderTicket, money, dateTime, muted, danger, MARGIN } from './ticket-pdf.js';

// Comprobante de vale (adelanto al personal) en papel de 80 mm, con firma de quien lo recibe.
const pagoLabel = tipo => ({ DIARIO: 'Diario', SEMANAL: 'Semanal', QUINCENAL: 'Quincenal', MENSUAL: 'Mensual' })[tipo] || tipo || '—';

function layout(doc, { vale, restaurante }, printedAt) {
  const { state, text, pair, rule, space, header, signature } = writer(doc);
  header(restaurante);
  text('VALE AL PERSONAL', { size: 14, bold: true, align: 'center', gap: 1 });
  text(`VALE #${vale.idvale} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  if (vale.estado === 'anulado') text('*** ANULADO ***', { size: 13, bold: true, align: 'center', color: danger, gap: 4 });

  rule();
  pair('Fecha', dateTime(vale.fecha_vale));
  pair('Personal', vale.personal_nombre || '—');
  if (vale.personal_documento) pair('Documento', vale.personal_documento);
  if (vale.personal_cargo) pair('Cargo', vale.personal_cargo);
  pair('Pago', pagoLabel(vale.personal_tipo_pago));
  pair('Forma de pago', vale.forma_pago_nombre || '—');
  space(2);
  text('Concepto', { size: 8, bold: true, gap: 1 });
  text(vale.descripcion, { size: 8.5, gap: 4 });

  rule();
  pair('IMPORTE', money(vale.monto_vale), { bold: true });

  rule();
  pair('Registrado por', vale.creado_por || '—');
  if (vale.estado === 'anulado') {
    pair('Anulado por', vale.anulado_por || '—');
    pair('Anulado', dateTime(vale.fecha_anulado));
    if (vale.motivo_anulado) text(`Motivo: ${vale.motivo_anulado}`, { size: 8, color: muted, gap: 3 });
  }
  pair('Impreso', dateTime(printedAt));
  signature(`Recibí conforme · ${vale.personal_nombre || ''}`);
  return state.y + MARGIN;
}

export function renderValeTicket(data, printedAt = new Date()) {
  return renderTicket(layout, data, `Vale #${data.vale.idvale}`, printedAt);
}
