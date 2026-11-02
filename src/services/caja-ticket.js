import PDFDocument from 'pdfkit';

const WIDTH = 80 * 72 / 25.4;
const MAX_HEIGHT = 14400; // límite de pdfkit/PDF para una página
const MARGIN = 12;
const CONTENT = WIDTH - MARGIN * 2;
const money = value => `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
const timeZone = process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion';
const date = value => value ? new Intl.DateTimeFormat('es-PY', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

// Dibuja el ticket y devuelve la altura usada; sirve para medir y luego para dibujar en una sola página.
function layout(doc, { caja, efectivoId, efectivoNombre = 'Efectivo', arqueos, ingresos, egresos, categorias, productos, anulados }, printedAt) {
  let y = MARGIN;
  const space = () => {};
  const text = (value, { size = 8.5, bold = false, align = 'left', color = '#17201f', gap = 3 } = {}) => {
    const content = String(value ?? '').trim();
    if (!content) return;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = doc.heightOfString(content, { width: CONTENT, align, lineGap: 1 });
    space(height + gap);
    doc.fillColor(color).text(content, MARGIN, y, { width: CONTENT, align, lineGap: 1 });
    y += height + gap;
  };
  const pair = (label, value, { bold = false, size = bold ? 9.5 : 8.5 } = {}) => {
    const leftWidth = CONTENT * .55;
    const rightWidth = CONTENT - leftWidth - 3;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = Math.max(doc.heightOfString(label, { width: leftWidth }), doc.heightOfString(value, { width: rightWidth }));
    space(height + 3);
    doc.fillColor('#17201f').text(label, MARGIN, y, { width: leftWidth });
    doc.text(value, MARGIN + leftWidth + 3, y, { width: rightWidth, align: 'right' });
    y += height + 3;
  };
  const rule = () => { space(11); y += 3; doc.moveTo(MARGIN, y).lineTo(WIDTH - MARGIN, y).lineWidth(.5).strokeColor('#9aa8a0').stroke(); y += 8; };
  const section = title => { rule(); text(title, { size: 9.5, bold: true, gap: 4 }); };
  const empty = () => text('Sin movimientos.', { size: 8, color: '#52625c' });
  const sum = rows => rows.reduce((total, row) => total + Number(row.monto || 0), 0);

  text('CIERRE DE CAJA', { size: 15, bold: true, align: 'center', gap: 1 });
  text(`CAJA #${caja.idcaja_gral} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: '#52625c', gap: 6 });
  pair('Fecha inicio', date(caja.fecha_apertura));
  pair('Fecha fin', date(caja.fecha_cierre));
  pair('Abierta por', caja.creado_por || '—');
  pair('Cerrada por', caja.cerrado_por || '—');
  pair('Impreso', date(printedAt));

  section('INICIO DE CAJA');
  pair(efectivoNombre, money(caja.monto_inicial), { bold: true });

  section('INGRESOS');
  if (!ingresos.length) empty();
  for (const row of ingresos) pair(`${row.etiqueta} (${row.cantidad})`, money(row.monto));
  pair('TOTAL INGRESOS', money(caja.total_ingresos ?? sum(ingresos)), { bold: true });

  section('EGRESOS');
  if (!egresos.length) empty();
  for (const row of egresos) pair(`${row.etiqueta} (${row.cantidad})`, money(row.monto));
  pair('TOTAL EGRESOS', money(caja.total_egresos ?? sum(egresos)), { bold: true });

  section('FORMAS DE PAGO');
  if (!arqueos.length) empty();
  for (const row of arqueos) {
    text(row.forma_pago, { bold: true, gap: 1 });
    pair('Ingresos', money(row.total_ingresos));
    pair('Egresos', money(row.total_egresos));
    y += 3;
  }

  const cashRow = arqueos.find(row => row.fk_idforma_pago === efectivoId);
  section(`ARQUEO DE ${efectivoNombre.toUpperCase()}`);
  pair('Inicio de caja', money(caja.monto_inicial));
  pair('Esperado', money(cashRow?.monto_esperado ?? caja.monto_inicial));
  pair('Contado', money(cashRow?.monto_contado ?? 0));
  pair('DIFERENCIA', money(cashRow?.diferencia ?? 0), { bold: true });

  section('TOP CATEGORÍAS');
  if (!categorias.length) empty();
  categorias.forEach((row, index) => pair(`${index + 1}. ${row.nombre} (${row.cantidad})`, money(row.importe)));

  section('PRODUCTOS MÁS VENDIDOS');
  if (!productos.length) empty();
  productos.forEach((row, index) => pair(`${index + 1}. ${row.nombre} (${row.cantidad})`, money(row.importe)));

  section(`PEDIDOS ANULADOS (${anulados.length})`);
  if (!anulados.length) text('Sin pedidos anulados.', { size: 8, color: '#52625c' });
  for (const row of anulados) {
    pair(`#${row.idpedido} · ${date(row.fecha_anulado)}`, money(row.monto_total));
    text(`${row.tipo_entrega}${row.mesa_numero ? ` · Mesa ${row.mesa_numero}` : ''} · ${row.anulado_por}${row.motivo_anulado ? ` · ${row.motivo_anulado}` : ''}`, { size: 7.5, color: '#52625c', gap: 4 });
  }

  rule();
  text('Fin del cierre de caja', { align: 'center', gap: 0 });
  return y + MARGIN;
}

export function renderCajaTicket(data, printedAt = new Date()) {
  const info = { Title: `Cierre de caja #${data.caja.idcaja_gral}`, Author: 'Restaurante Web' };
  const probe = new PDFDocument({ size: [WIDTH, MAX_HEIGHT], margin: 0, info });
  probe.on('data', () => {});
  const height = Math.min(MAX_HEIGHT, Math.ceil(layout(probe, data, printedAt)));
  probe.end();
  const doc = new PDFDocument({ size: [WIDTH, height], margin: 0, compress: true, info });
  layout(doc, data, printedAt);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}
