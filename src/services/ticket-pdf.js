import PDFDocument from 'pdfkit';
import { leerConfigImpresora } from './impresora-config.js';

// Utilidades comunes para los tickets térmicos (58 u 80 mm según Configuración → Impresora).
export const MM = 72 / 25.4;
// Largo máximo de una hoja. Pasados unos 3,25 m Windows descarta el alto pedido y el driver imprime solo 30 cm,
// sin avisar (medido con POS-80-Series). Un ticket más largo sigue en otra hoja y la impresora corta entre las dos.
export const LARGO_MAX = 3000 * MM;
export const textoContinuacion = hoja => `Continuación · hoja ${hoja}`;
// Alto de un salto de línea en blanco al final (1/6", el avance por defecto de las impresoras térmicas).
const ALTO_SALTO = 12;

// El cabezal no llega a los bordes del rollo: en el de 80 mm (o de 74 a 80) imprime 72 mm y en el de 58 imprime 48.
// El driver empieza a imprimir donde empieza el cabezal y recorta lo que sobra a la derecha, así que la página
// del PDF mide lo que se imprime, no lo que mide el rollo.
const PAPELES = {
  80: { util: 72, margen: 2, vertical: 4, escala: 1 },
  58: { util: 48, margen: 1.5, vertical: 4, escala: .82 }
};

// Ancho, márgenes y escala de letra para el papel configurado, más el espacio en blanco antes del corte.
export function medidas(config = {}) {
  const tamano = Number(config.tamano_ticket) === 58 ? 58 : 80;
  const saltos = Number(config.saltos_final);
  const { util, margen, vertical, escala } = PAPELES[tamano];
  const width = util * MM, margin = margen * MM;
  return {
    tamano, util, WIDTH: width, MARGIN: margin, MARGIN_Y: vertical * MM, CONTENT: width - margin * 2, escala,
    saltos: Number.isInteger(saltos) && saltos >= 0 && saltos <= 30 ? saltos : 5,
    get relleno() { return this.saltos * ALTO_SALTO; }
  };
}

export async function medidasTicket(config) {
  return medidas(config ?? await leerConfigImpresora());
}

// Medidas de 80 mm, para quien todavía las importe como constantes.
const m80 = medidas();
export const WIDTH = m80.WIDTH;
export const MARGIN = m80.MARGIN;
export const CONTENT = m80.CONTENT;
// La térmica solo imprime negro: cualquier otro color (gris, rojo o un casi negro) sale punteado y apenas se lee.
// Los nombres se mantienen para indicar la intención; lo secundario se distingue por el tamaño y lo importante por la negrita.
export const ink = '#000000';
export const muted = ink;
export const danger = ink;
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
// Toma las medidas de doc.ticket (las pone renderTicket); sin ellas usa 80 mm.
export function writer(doc) {
  const m = doc.ticket || m80;
  const { WIDTH, MARGIN, MARGIN_Y, CONTENT, escala } = m;
  const state = { y: MARGIN_Y };
  // Si lo que sigue no entra en la hoja, la cierra (con sus saltos) y sigue en otra. Llamar antes de dibujar.
  const cerradas = [];
  doc.cerradas = cerradas;
  const reservar = height => {
    if (state.y + height + MARGIN_Y + m.relleno <= LARGO_MAX) return false;
    cerradas.push(Math.ceil(state.y + MARGIN_Y + m.relleno));
    // Al dibujar, cada hoja tiene el alto que se midió; al medir, el máximo.
    doc.addPage({ size: [WIDTH, doc.altos?.[cerradas.length] ?? LARGO_MAX], margin: 0 });
    doc.font('Helvetica-Bold').fontSize(8 * escala).fillColor(ink)
      .text(textoContinuacion(cerradas.length + 1), MARGIN, MARGIN_Y, { width: CONTENT, align: 'center' });
    state.y = MARGIN_Y + 16;
    return true;
  };
  const text = (value, { size = 8.5, bold = false, align = 'left', color = ink, gap = 3, indent = 0 } = {}) => {
    const content = String(value ?? '').trim();
    if (!content) return;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size * escala);
    const left = indent * escala;
    const height = doc.heightOfString(content, { width: CONTENT - left, align, lineGap: 1 });
    if (reservar(height + gap * escala)) doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size * escala);
    doc.fillColor(color).text(content, MARGIN + left, state.y, { width: CONTENT - left, align, lineGap: 1 });
    state.y += height + gap * escala;
  };
  const pair = (label, value, { bold = false, size = bold ? 10 : 8.5, color = ink, leftRatio = .42, gap = 3 } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size * escala);
    let leftWidth = CONTENT * leftRatio;
    // Un importe nunca se parte en dos renglones: si no entra, le cede lugar la etiqueta.
    if (/^(- )?Gs\.\s-?[\d.]+$/.test(value)) leftWidth = Math.max(CONTENT * .2, Math.min(leftWidth, CONTENT - 4 - doc.widthOfString(value)));
    const rightWidth = CONTENT - leftWidth - 3;
    const height = Math.max(doc.heightOfString(label, { width: leftWidth }), doc.heightOfString(value, { width: rightWidth }));
    if (reservar(height + gap * escala)) doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size * escala);
    doc.fillColor(color).text(label, MARGIN, state.y, { width: leftWidth });
    doc.text(value, MARGIN + leftWidth + 3, state.y, { width: rightWidth, align: 'right' });
    state.y += height + gap * escala;
  };
  const rule = () => { reservar(11); state.y += 3; doc.moveTo(MARGIN, state.y).lineTo(WIDTH - MARGIN, state.y).lineWidth(.5).strokeColor(ink).stroke(); state.y += 8; };
  const space = amount => { state.y += amount; };
  const header = restaurante => {
    const nombre = restaurante?.nombre_fantasia || restaurante?.razon_social;
    if (nombre) text(nombre, { size: 11, bold: true, align: 'center', gap: 1 });
    if (restaurante?.ruc) text(`RUC ${restaurante.ruc}`, { size: 7.5, align: 'center', color: muted, gap: 1 });
    if (restaurante?.direccion) text([restaurante.direccion, restaurante.ciudad].filter(Boolean).join(' · '), { size: 7.5, align: 'center', color: muted, gap: 1 });
    if (nombre) space(4);
  };
  const signature = label => {
    reservar(60);
    space(28);
    doc.moveTo(MARGIN + CONTENT * .15, state.y).lineTo(WIDTH - MARGIN - CONTENT * .15, state.y).lineWidth(.5).strokeColor(ink).stroke();
    space(4);
    text(label, { size: 7.5, align: 'center', color: muted, gap: 0 });
  };
  // Altura usada hasta acá más el margen inferior (lo que devuelve cada layout).
  const end = () => state.y + MARGIN_Y;
  return { state, text, pair, rule, space, header, signature, end, m };
}

export async function restaurantInfo(client) {
  const result = await client.query('SELECT nombre_fantasia,razon_social,ruc,direccion,ciudad,telefono FROM datos_restaurante WHERE iddatos_restaurante=1').catch(() => ({ rows: [] }));
  return result.rows[0] || null;
}

// Alto de cada hoja que necesita un layout, con los saltos del final (casi siempre es una sola).
export function medirTicket(layout, data, m, printedAt = new Date()) {
  const probe = new PDFDocument({ size: [m.WIDTH, LARGO_MAX], margin: 0 });
  probe.ticket = m;
  probe.on('data', () => {});
  const ultima = Math.ceil(layout(probe, data, printedAt) + m.relleno);
  probe.end();
  return [...(probe.cerradas || []), ultima];
}

// layout(doc, data, printedAt) dibuja y devuelve la altura usada: se mide primero y luego se dibuja (una hoja, o más si supera LARGO_MAX).
// El ancho y los saltos en blanco del final salen de la configuración de impresora (o de `config`, si se pasa).
export async function renderTicket(layout, data, title, printedAt = new Date(), config) {
  const m = await medidasTicket(config);
  const info = { Title: title, Author: 'Restaurante Web' };
  const altos = medirTicket(layout, data, m, printedAt);
  const doc = new PDFDocument({ size: [m.WIDTH, altos[0]], margin: 0, compress: true, info });
  doc.ticket = m;
  doc.altos = altos;
  layout(doc, data, printedAt);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

// Ruta de un ticket (PDF). La impresión directa la hace el agente de impresión de cada PC.
export function ticketRoute(router, path, ...handlers) {
  router.get(path, ...handlers);
}

export function sendPdf(res, pdf, filename) {
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${filename}"`, 'Cache-Control': 'no-store', 'Content-Length': String(pdf.length) });
  res.send(pdf);
}
