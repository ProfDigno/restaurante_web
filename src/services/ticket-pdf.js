import PDFDocument from 'pdfkit';

// Utilidades comunes para comprobantes de 80 mm (gasto, compra).
export const WIDTH = 80 * 72 / 25.4;
const MAX_HEIGHT = 14400; // límite de pdfkit/PDF para una página
export const MARGIN = 12;
export const CONTENT = WIDTH - MARGIN * 2;
export const ink = '#17201f';
export const muted = '#52625c';
export const danger = '#a32020';
export const money = value => `Gs. ${new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value || 0))}`;
export const quantity = value => new Intl.NumberFormat('es-PY', { maximumFractionDigits: 3 }).format(Number(value || 0));
const timeZone = process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion';
export const dateTime = value => value ? new Intl.DateTimeFormat('es-PY', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
// Fechas cargadas por el usuario (sin hora significativa): se muestran tal cual, sin correr el día por zona horaria.
export const dateOnly = value => {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
};

// Devuelve funciones de dibujo que avanzan una posición vertical compartida.
export function writer(doc) {
  const state = { y: MARGIN };
  const text = (value, { size = 8.5, bold = false, align = 'left', color = ink, gap = 3 } = {}) => {
    const content = String(value ?? '').trim();
    if (!content) return;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = doc.heightOfString(content, { width: CONTENT, align, lineGap: 1 });
    doc.fillColor(color).text(content, MARGIN, state.y, { width: CONTENT, align, lineGap: 1 });
    state.y += height + gap;
  };
  const pair = (label, value, { bold = false, size = bold ? 10 : 8.5, color = ink, leftRatio = .42 } = {}) => {
    const leftWidth = CONTENT * leftRatio;
    const rightWidth = CONTENT - leftWidth - 3;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const height = Math.max(doc.heightOfString(label, { width: leftWidth }), doc.heightOfString(value, { width: rightWidth }));
    doc.fillColor(color).text(label, MARGIN, state.y, { width: leftWidth });
    doc.text(value, MARGIN + leftWidth + 3, state.y, { width: rightWidth, align: 'right' });
    state.y += height + 3;
  };
  const rule = () => { state.y += 3; doc.moveTo(MARGIN, state.y).lineTo(WIDTH - MARGIN, state.y).lineWidth(.5).strokeColor('#9aa8a0').stroke(); state.y += 8; };
  const space = amount => { state.y += amount; };
  const header = restaurante => {
    const nombre = restaurante?.nombre_fantasia || restaurante?.razon_social;
    if (nombre) text(nombre, { size: 11, bold: true, align: 'center', gap: 1 });
    if (restaurante?.ruc) text(`RUC ${restaurante.ruc}`, { size: 7.5, align: 'center', color: muted, gap: 1 });
    if (restaurante?.direccion) text([restaurante.direccion, restaurante.ciudad].filter(Boolean).join(' · '), { size: 7.5, align: 'center', color: muted, gap: 1 });
    if (nombre) space(4);
  };
  const signature = label => {
    space(28);
    doc.moveTo(MARGIN + CONTENT * .15, state.y).lineTo(WIDTH - MARGIN - CONTENT * .15, state.y).lineWidth(.5).strokeColor(ink).stroke();
    space(4);
    text(label, { size: 7.5, align: 'center', color: muted, gap: 0 });
  };
  return { state, text, pair, rule, space, header, signature };
}

export async function restaurantInfo(client) {
  const result = await client.query('SELECT nombre_fantasia,razon_social,ruc,direccion,ciudad FROM datos_restaurante WHERE iddatos_restaurante=1').catch(() => ({ rows: [] }));
  return result.rows[0] || null;
}

// layout(doc, data, printedAt) dibuja y devuelve la altura usada: se mide primero y luego se dibuja en una sola página.
export function renderTicket(layout, data, title, printedAt = new Date()) {
  const info = { Title: title, Author: 'Restaurante Web' };
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

export function sendPdf(res, pdf, filename) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store', 'Content-Length': String(pdf.length) });
  res.send(pdf);
}
