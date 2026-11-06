import { writer, renderTicket, money, quantity, dateTime, dateOnly, ink, muted, danger, MARGIN } from './ticket-pdf.js';

// Comprobante de compra en papel de 80 mm: proveedor, productos, total, pagos y saldo.
const stateLabel = compra => compra.estado === 'cancelada' ? 'CANCELADA'
  : compra.estado === 'borrador' ? 'BORRADOR'
  : compra.estado_pago === 'pagada' ? 'RECIBIDA · PAGADA' : 'RECIBIDA · PAGO PENDIENTE';

function layout(doc, { compra, restaurante }, printedAt) {
  const { state, text, pair, rule, space, header, signature } = writer(doc);
  const borrador = compra.estado === 'borrador';
  const total = borrador ? Number(compra.total_borrador || 0) : Number(compra.total || 0);
  const pagos = compra.pagos || [];
  const pagado = pagos.filter(p => p.estado === 'aprobado').reduce((sum, p) => sum + Number(p.importe || 0), 0);

  header(restaurante);
  text('COMPROBANTE DE COMPRA', { size: 14, bold: true, align: 'center', gap: 1 });
  text(`COMPRA #${compra.idcompra} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  if (compra.estado === 'cancelada') text('*** CANCELADA ***', { size: 13, bold: true, align: 'center', color: danger, gap: 4 });
  if (borrador) text('BORRADOR · SIN RECIBIR', { size: 10, bold: true, align: 'center', gap: 4 });

  rule();
  pair('Fecha de compra', dateOnly(compra.fecha_compra));
  pair('Proveedor', compra.proveedor_nombre || '—');
  if (compra.proveedor_ruc) pair('RUC', compra.proveedor_ruc);
  if (compra.proveedor_telefono) pair('Teléfono', compra.proveedor_telefono);
  pair('Condición', compra.condicion || '—');
  if (compra.numero_nota) pair('Nota / factura', compra.numero_nota);
  pair('Estado', stateLabel(compra));

  rule();
  text(`PRODUCTOS (${(compra.detalles || []).length})`, { size: 9.5, bold: true, gap: 4 });
  for (const line of compra.detalles || []) {
    text(line.producto ? `${line.producto}${line.unidad ? ` · ${line.unidad}` : ''}` : line.nombre, { size: 8.5, gap: 1 });
    pair(`${quantity(line.cantidad)} x ${money(line.precio_compra)}`, money(line.subtotal), { color: ink, leftRatio: .6 });
    space(1);
  }

  rule();
  pair(borrador ? 'TOTAL ESTIMADO' : 'TOTAL', money(total), { bold: true, leftRatio: .55 });

  if (!borrador) {
    rule();
    text('PAGOS', { size: 9.5, bold: true, gap: 4 });
    if (!pagos.length) text('Sin pagos registrados.', { size: 8, color: muted });
    for (const p of pagos) {
      const anulado = p.estado !== 'aprobado';
      pair(`${dateTime(p.fecha_creado)} · ${p.forma_pago_nombre}${anulado ? ' (anulado)' : ''}`, money(p.importe), { color: anulado ? muted : ink, leftRatio: .64 });
    }
    pair('Pagado', money(pagado));
    pair('SALDO', money(Math.max(0, total - pagado)), { bold: true });
  }

  if (compra.observacion) {
    rule();
    text('Observación', { size: 8, bold: true, gap: 1 });
    text(compra.observacion, { size: 8, gap: 3 });
  }

  rule();
  pair('Registrado por', compra.creado_por || '—');
  pair('Registrado', dateTime(compra.fecha_creado));
  if (compra.estado === 'cancelada') {
    pair('Cancelada por', compra.anulado_por || '—');
    pair('Cancelada', dateTime(compra.fecha_anulado));
    if (compra.motivo_anulado) text(`Motivo: ${compra.motivo_anulado}`, { size: 8, color: muted, gap: 3 });
  }
  pair('Impreso', dateTime(printedAt));
  signature('Firma / Recibí conforme');
  return state.y + MARGIN;
}

export function renderCompraTicket(data, printedAt = new Date()) {
  return renderTicket(layout, data, `Compra #${data.compra.idcompra}`, printedAt);
}
