import PDFDocument from 'pdfkit';

const MM = 72 / 25.4;
const WIDTH = 80 * MM;
const MARGIN = 4 * MM;
const CONTENT = WIDTH - 2 * MARGIN;
const LEFT = MARGIN;
const RIGHT = WIDTH - MARGIN;
const ink = '#17201f';
const muted = '#52625c';
const money = value => `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
const date = value => new Intl.DateTimeFormat('es-PY', { timeZone: process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const clean = value => String(value ?? '').trim();
const escapeHtml = value => clean(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function renderPedidoTicketPage(pedido) {
  const safe = escapeHtml;
  const row = (label, value, className = '') => `<div class="row ${className}"><span>${safe(label)}</span><strong>${safe(value)}</strong></div>`;
  const field = (label, value) => clean(value) ? `<div class="field"><strong>${safe(label)}:</strong> ${safe(value)}</div>` : '';
  const delivery = { COMER_ACA: 'Comer acá', DELIVERY: 'Delivery', BUSCAR: 'Retiro' }[pedido.tipo_entrega] || pedido.tipo_entrega;
  const printed = date(new Date());
  let products = 0;
  const lines = (pedido.detalles || []).map(line => {
    const quantity = Number(line.cantidad || 0);
    const extras = (line.ingredientes || []).reduce((sum, item) => sum + (item.tipo_modificacion === 'AGREGAR' ? Number(item.precio_venta || 0) : 0), 0);
    const unitPrice = Number(line.precio_venta || 0) + extras;
    products += quantity * unitPrice;
    const ingredients = (line.ingredientes || []).map(item => `<div class="minor">${safe(item.tipo_modificacion === 'QUITAR' ? 'Sin' : 'Con')} ${safe(item.nombre)}${item.tipo_modificacion === 'AGREGAR' && Number(item.precio_venta) ? ` (${safe(money(item.precio_venta))} c/u)` : ''}</div>`).join('');
    return `<div class="product"><strong>${safe(line.nombre_mostrado || line.nombre || 'Producto')}</strong>${line.unidad ? `<div class="minor">Unidad: ${safe(line.unidad)}</div>` : ''}${ingredients}${row(`${quantity} x ${money(unitPrice)}`, money(quantity * unitPrice))}</div>`;
  }).join('');
  const advance = pedido.pago_anticipado;
  const netAdvance = advance?.estado === 'aprobado' ? Math.max(0, Number(advance.importe) - Number(advance.devuelto || 0)) : 0;
  const payment = advance ? `${row(`Anticipo (${advance.forma_pago_nombre})`, money(advance.importe))}${Number(advance.devuelto) ? row('Anticipo devuelto', `- ${money(advance.devuelto)}`) : ''}${advance.estado !== 'aprobado' ? '<div class="minor">Anticipo anulado</div>' : ''}` : '';
  const balance = pedido.estado === 'cancelado' ? '' : `${row('Resta tras anticipo', money(Math.max(0, Number(pedido.monto_total) - netAdvance)), 'strong')}<div class="minor">No incluye cobros de la cuenta o mesa</div>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket pedido #${pedido.idpedido}</title>
<style id="page-size">@page{size:80mm 200mm;margin:0}</style><style>
*{box-sizing:border-box}body{margin:0;background:#edf1ee;color:#151c19;font:12px Arial,sans-serif}.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:#fff;border-bottom:1px solid #d9e2dc}.toolbar strong{margin-right:auto}.toolbar button,.toolbar a{padding:9px 13px;border:1px solid #cfdad2;border-radius:8px;background:#fff;color:#17201f;font:inherit;text-decoration:none;cursor:pointer}.toolbar button{background:#c76648;color:#fff;border-color:#c76648}.ticket{width:80mm;max-width:100%;margin:18px auto;padding:4mm;background:#fff;box-shadow:0 8px 30px #0002;overflow-wrap:anywhere}.ticket h1{margin:0;text-align:center;font-size:18px}.caption{text-align:center;font-size:9px;color:#53625b;margin:5px 0 11px}.cancelled{text-align:center;font-size:13px;font-weight:700;margin:8px 0}.field{margin:3px 0;line-height:1.35}.field strong{font-weight:700}.row{display:flex;justify-content:space-between;gap:7px;align-items:flex-start;margin:4px 0;line-height:1.3}.row span{min-width:0;flex:1}.row strong{text-align:right;max-width:52%;overflow-wrap:anywhere;font-weight:400}.row.strong,.row.strong strong{font-weight:700;font-size:14px}.ticket hr{border:0;border-top:1px solid #9aa8a0;margin:10px 0}.section-title{font-size:12px;font-weight:700;margin-bottom:8px}.product{margin:0 0 11px}.product>strong{display:block;line-height:1.35}.minor{color:#52625c;font-size:10px;line-height:1.35;margin:2px 0}.footer{text-align:center;font-size:11px;margin-top:11px}@media print{body{background:#fff}.toolbar{display:none}.ticket{margin:0;box-shadow:none;max-width:none}}
</style></head><body><div class="toolbar"><strong>Pedido #${pedido.idpedido} · Ticket 80 mm</strong><button type="button" id="print">Imprimir</button><a href="/api/pedidos/${pedido.idpedido}/ticket.pdf" download="pedido-${pedido.idpedido}.pdf">Descargar PDF</a></div><main class="ticket" id="ticket"><h1>PEDIDO #${pedido.idpedido}</h1><div class="caption">COMPROBANTE DE PEDIDO · NO FISCAL</div>${pedido.estado === 'cancelado' ? '<div class="cancelled">PEDIDO ANULADO</div>' : ''}${row('Pedido', date(pedido.fecha_confirmado || pedido.fecha_creado))}${row('Impreso', printed)}${field('Cliente', pedido.cliente?.nombre_completo || 'Sin cliente')}${field('Teléfono', pedido.cliente?.telefono)}${field('Entrega', delivery)}${pedido.tipo_entrega === 'COMER_ACA' ? field('Mesa', pedido.numero_mesa) : ''}${pedido.tipo_entrega === 'DELIVERY' ? `${field('Dirección', pedido.direccion_entrega)}${field('Zona', pedido.zona_nombre)}${pedido.telefono_entrega !== pedido.cliente?.telefono ? field('Teléfono entrega', pedido.telefono_entrega) : ''}${field('Entregador', pedido.entregador_nombre)}` : ''}<hr><div class="section-title">DETALLE</div>${lines}${pedido.observacion ? `<hr>${field('Observación', pedido.observacion)}` : ''}<hr>${row('Productos', money(products))}${Number(pedido.monto_delivery) ? row('Delivery', money(pedido.monto_delivery)) : ''}${Number(pedido.monto_recargo) ? row('Recargo', money(pedido.monto_recargo)) : ''}${pedido.motivo_recargo ? field('Motivo recargo', pedido.motivo_recargo) : ''}${Number(pedido.monto_descuento) ? row('Descuento', `- ${money(pedido.monto_descuento)}`) : ''}${pedido.motivo_descuento ? field('Motivo descuento', pedido.motivo_descuento) : ''}<hr>${row('TOTAL', money(pedido.monto_total), 'strong')}${payment}${balance}<hr><div class="footer">Gracias por su pedido</div></main><script>
function updatePageSize(){const ticket=document.getElementById('ticket');const millimeters=Math.ceil(ticket.getBoundingClientRect().height*25.4/96+2);document.getElementById('page-size').textContent='@page{size:80mm '+millimeters+'mm;margin:0}'}
document.getElementById('print').addEventListener('click',()=>{updatePageSize();window.print()});
window.addEventListener('load',()=>{updatePageSize();setTimeout(()=>window.print(),400)});
window.addEventListener('beforeprint',updatePageSize);
</script></body></html>`;
}

// Measure every wrapped line before creating the page: thermal rolls need a
// fixed PDF width but the page height must follow the actual order content.
export function renderPedidoTicket(pedido, printedAt = new Date()) {
  const measure = new PDFDocument({ size: [WIDTH, 1000], margin: 0, autoFirstPage: false });
  const commands = [];
  let y = MARGIN;
  const text = (value, options = {}) => {
    const content = clean(value);
    if (!content) return;
    const { size = 8.5, bold = false, align = 'left', width = CONTENT, x = LEFT, gap = 2, color = ink } = options;
    measure.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = measure.heightOfString(content, { width, align, lineGap: 1 });
    commands.push({ kind: 'text', content, x, y, width, size, bold, align, color });
    y += height + gap;
  };
  const rule = () => { y += 3; commands.push({ kind: 'rule', y }); y += 7; };
  const pair = (label, value, options = {}) => {
    const labelWidth = CONTENT * 0.46;
    const valueWidth = CONTENT - labelWidth - 3;
    const size = options.size || 8.5;
    measure.font(options.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const labelHeight = measure.heightOfString(label, { width: labelWidth, lineGap: 1 });
    const valueHeight = measure.heightOfString(value, { width: valueWidth, lineGap: 1 });
    commands.push({ kind: 'text', content: label, x: LEFT, y, width: labelWidth, size, bold: !!options.bold, align: 'left', color: ink });
    commands.push({ kind: 'text', content: value, x: RIGHT - valueWidth, y, width: valueWidth, size, bold: !!options.bold, align: 'right', color: ink });
    y += Math.max(labelHeight, valueHeight) + (options.gap ?? 3);
  };

  text('PEDIDO #' + pedido.idpedido, { size: 14, bold: true, align: 'center', gap: 4 });
  text('COMPROBANTE DE PEDIDO · NO FISCAL', { size: 7, align: 'center', color: muted, gap: 5 });
  if (pedido.estado === 'cancelado') text('PEDIDO ANULADO', { size: 10, bold: true, align: 'center', gap: 5 });
  pair('Pedido', date(pedido.fecha_confirmado || pedido.fecha_creado));
  pair('Impreso', date(printedAt));
  text(`Cliente: ${clean(pedido.cliente?.nombre_completo) || 'Sin cliente'}`);
  if (pedido.cliente?.telefono) text(`Teléfono: ${pedido.cliente.telefono}`);
  const delivery = { COMER_ACA: 'Comer acá', DELIVERY: 'Delivery', BUSCAR: 'Retiro' }[pedido.tipo_entrega] || pedido.tipo_entrega;
  text(`Entrega: ${delivery}`);
  if (pedido.tipo_entrega === 'COMER_ACA' && pedido.numero_mesa) text(`Mesa: ${pedido.numero_mesa}`);
  if (pedido.tipo_entrega === 'DELIVERY') {
    if (pedido.direccion_entrega) text(`Dirección: ${pedido.direccion_entrega}`);
    if (pedido.zona_nombre) text(`Zona: ${pedido.zona_nombre}`);
    if (pedido.telefono_entrega && pedido.telefono_entrega !== pedido.cliente?.telefono) text(`Teléfono entrega: ${pedido.telefono_entrega}`);
    if (pedido.entregador_nombre) text(`Entregador: ${pedido.entregador_nombre}`);
  }
  rule();
  text('DETALLE', { size: 9, bold: true, gap: 5 });
  let products = 0;
  for (const line of pedido.detalles || []) {
    const quantity = Number(line.cantidad || 0);
    const extras = (line.ingredientes || []).reduce((sum, item) => sum + (item.tipo_modificacion === 'AGREGAR' ? Number(item.precio_venta || 0) : 0), 0);
    const unitPrice = Number(line.precio_venta || 0) + extras;
    products += quantity * unitPrice;
    text(line.nombre_mostrado || line.nombre || 'Producto', { bold: true, gap: 2 });
    if (line.unidad) text(`Unidad: ${line.unidad}`, { size: 7.5, color: muted, gap: 2 });
    for (const item of line.ingredientes || []) {
      const prefix = item.tipo_modificacion === 'QUITAR' ? 'Sin' : 'Con';
      text(`  ${prefix} ${item.nombre}${item.tipo_modificacion === 'AGREGAR' && Number(item.precio_venta) ? ` (${money(item.precio_venta)} c/u)` : ''}`, { size: 7.5, color: muted, gap: 1 });
    }
    pair(`${quantity} x ${money(unitPrice)}`, money(quantity * unitPrice), { gap: 6 });
  }
  if (pedido.observacion) { rule(); text(`Observación: ${pedido.observacion}`); }
  rule();
  pair('Productos', money(products));
  if (Number(pedido.monto_delivery)) pair('Delivery', money(pedido.monto_delivery));
  if (Number(pedido.monto_recargo)) pair('Recargo', money(pedido.monto_recargo));
  if (pedido.motivo_recargo) text(`Motivo recargo: ${pedido.motivo_recargo}`, { size: 7.5, color: muted });
  if (Number(pedido.monto_descuento)) pair('Descuento', `- ${money(pedido.monto_descuento)}`);
  if (pedido.motivo_descuento) text(`Motivo descuento: ${pedido.motivo_descuento}`, { size: 7.5, color: muted });
  rule();
  pair('TOTAL', money(pedido.monto_total), { size: 10.5, bold: true, gap: 5 });
  const advance = pedido.pago_anticipado;
  const netAdvance = advance?.estado === 'aprobado' ? Math.max(0, Number(advance.importe) - Number(advance.devuelto || 0)) : 0;
  if (advance) {
    pair(`Anticipo (${advance.forma_pago_nombre})`, money(advance.importe));
    if (Number(advance.devuelto)) pair('Anticipo devuelto', `- ${money(advance.devuelto)}`);
    if (advance.estado !== 'aprobado') text('Anticipo anulado', { size: 7.5, color: muted });
  }
  if (pedido.estado !== 'cancelado') {
    pair('Resta tras anticipo', money(Math.max(0, Number(pedido.monto_total) - netAdvance)), { bold: true });
    text('No incluye cobros de la cuenta o mesa', { size: 7, color: muted });
  }
  rule();
  text('Gracias por su pedido', { align: 'center', size: 8, gap: 0 });

  const height = Math.max(y + MARGIN, 55 * MM);
  if (height > 14000) throw new Error('El pedido es demasiado largo para un ticket PDF');
  const doc = new PDFDocument({ size: [WIDTH, height], margin: 0, compress: true, info: { Title: `Pedido #${pedido.idpedido}`, Author: 'Restaurante Web' } });
  for (const command of commands) {
    if (command.kind === 'rule') {
      doc.moveTo(LEFT, command.y).lineTo(RIGHT, command.y).lineWidth(0.5).strokeColor('#9aa8a0').stroke();
    } else {
      doc.font(command.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(command.size).fillColor(command.color)
        .text(command.content, command.x, command.y, { width: command.width, align: command.align, lineGap: 1 });
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}
