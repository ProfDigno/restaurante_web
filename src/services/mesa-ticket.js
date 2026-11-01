import PDFDocument from 'pdfkit';

const WIDTH = 80 * 72 / 25.4;
const HEIGHT = 800;
const MARGIN = 12;
const CONTENT = WIDTH - MARGIN * 2;
const money = value => `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
const date = value => new Intl.DateTimeFormat('es-PY', { timeZone: process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export function renderMesaTicket(cuenta, pedidos, pagos, printedAt = new Date()) {
  const abierta = cuenta.estado === 'abierta';
  const doc = new PDFDocument({ size: [WIDTH, HEIGHT], margin: 0, compress: true, info: { Title: `Mesa ${cuenta.mesa_numero} - Cuenta #${cuenta.idcuenta}`, Author: 'Restaurante Web' } });
  let y = MARGIN;
  const space = height => { if (y + height > HEIGHT - MARGIN) { doc.addPage(); y = MARGIN; } };
  const text = (value, { size = 8.5, bold = false, align = 'left', color = '#17201f', gap = 3 } = {}) => {
    const content = String(value ?? '').trim();
    if (!content) return;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = doc.heightOfString(content, { width: CONTENT, align, lineGap: 1 });
    space(height + gap);
    doc.fillColor(color).text(content, MARGIN, y, { width: CONTENT, align, lineGap: 1 });
    y += height + gap;
  };
  const pair = (label, value, bold = false) => {
    const leftWidth = CONTENT * .48;
    const rightWidth = CONTENT - leftWidth - 3;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5);
    const height = Math.max(doc.heightOfString(label, { width: leftWidth }), doc.heightOfString(value, { width: rightWidth }));
    space(height + 4);
    doc.text(label, MARGIN, y, { width: leftWidth });
    doc.text(value, MARGIN + leftWidth + 3, y, { width: rightWidth, align: 'right' });
    y += height + 4;
  };
  const rule = () => { space(11); y += 3; doc.moveTo(MARGIN, y).lineTo(WIDTH - MARGIN, y).lineWidth(.5).strokeColor('#9aa8a0').stroke(); y += 8; };

  text(`MESA ${cuenta.mesa_numero}`, { size: 15, bold: true, align: 'center' });
  text(`CUENTA #${cuenta.idcuenta} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: '#52625c', gap: 6 });
  if (abierta) text('CUENTA ABIERTA', { size: 9, bold: true, align: 'center', gap: 6 });
  pair('Inicio', date(cuenta.fecha_apertura));
  if (!abierta) pair('Fin', date(cuenta.fecha_cierre));
  pair('Impreso', date(printedAt));
  text(`Cliente: ${cuenta.cliente || 'Sin cliente'}`);
  rule();
  for (const pedido of pedidos) {
    text(`PEDIDO #${pedido.idpedido}`, { size: 9.5, bold: true });
    for (const line of pedido.detalles || []) {
      const quantity = Number(line.cantidad || 0);
      const extras = (line.ingredientes || []).reduce((sum, item) => sum + (item.tipo_modificacion === 'AGREGAR' ? Number(item.precio_venta || 0) : 0), 0);
      const unitPrice = Number(line.precio_venta || 0) + extras;
      text(line.nombre_mostrado || line.nombre || 'Producto', { bold: true, gap: 1 });
      for (const item of line.ingredientes || []) text(`  ${item.tipo_modificacion === 'QUITAR' ? 'Sin' : 'Con'} ${item.nombre}${item.tipo_modificacion === 'AGREGAR' && Number(item.precio_venta) ? ` (${money(item.precio_venta)} c/u)` : ''}`, { size: 7.5, color: '#52625c', gap: 1 });
      pair(`${quantity} x ${money(unitPrice)}`, money(quantity * unitPrice));
    }
    if (Number(pedido.monto_recargo)) pair('Recargo', money(pedido.monto_recargo));
    if (Number(pedido.monto_descuento)) pair('Descuento', `- ${money(pedido.monto_descuento)}`);
    pair(`Subtotal pedido #${pedido.idpedido}`, money(pedido.monto_total));
    rule();
  }
  if (!pedidos.length) text('Sin pedidos vigentes.');
  pair('TOTAL CUENTA', money(cuenta.total), true);
  if (pagos.length) {
    rule();
    text('PAGOS', { size: 9, bold: true });
    for (const pago of pagos) {
      if (pago.estado !== 'aprobado') continue;
      pair(`${pago.forma_pago} · #${pago.idpago}`, money(pago.importe));
      if (Number(pago.devuelto)) pair('Devuelto', `- ${money(pago.devuelto)}`);
    }
  }
  if (abierta) {
    rule();
    pair('COBRADO NETO', money(cuenta.cobrado));
    pair('SALDO', money(cuenta.saldo), true);
  }
  rule();
  text('Gracias por su visita', { align: 'center', gap: 0 });
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}
