import { writer, renderTicket, money, muted } from './ticket-pdf.js';

const timeZone = process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion';
const date = value => value ? new Intl.DateTimeFormat('es-PY', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

// Dibuja el ticket y devuelve la altura usada; sirve para medir y luego para dibujar en una sola página.
function layout(doc, { caja, efectivoId, efectivoNombre = 'Efectivo', arqueos, ingresos, egresos, categorias, productos, anulados }, printedAt) {
  const w = writer(doc);
  const { text, rule, space, end } = w;
  const pair = (label, value, { bold = false, size = bold ? 9.5 : 8.5 } = {}) => w.pair(label, value, { bold, size, leftRatio: .55 });
  const section = title => { rule(); text(title, { size: 9.5, bold: true, gap: 4 }); };
  const empty = () => text('Sin movimientos.', { size: 8, color: muted });
  const sum = rows => rows.reduce((total, row) => total + Number(row.monto || 0), 0);

  text('CIERRE DE CAJA', { size: 15, bold: true, align: 'center', gap: 1 });
  text(`CAJA #${caja.idcaja_gral} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
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
    space(3);
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
  if (!anulados.length) text('Sin pedidos anulados.', { size: 8, color: muted });
  for (const row of anulados) {
    pair(`#${row.idpedido} · ${date(row.fecha_anulado)}`, money(row.monto_total));
    text(`${row.tipo_entrega}${row.mesa_numero ? ` · Mesa ${row.mesa_numero}` : ''} · ${row.anulado_por}${row.motivo_anulado ? ` · ${row.motivo_anulado}` : ''}`, { size: 7.5, color: muted, gap: 4 });
  }

  rule();
  text('Fin del cierre de caja', { align: 'center', gap: 0 });
  return end();
}

export function renderCajaTicket(data, printedAt = new Date(), config) {
  return renderTicket(layout, data, `Cierre de caja #${data.caja.idcaja_gral}`, printedAt, config);
}
