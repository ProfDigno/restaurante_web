import PDFDocument from 'pdfkit';

// Factura en hoja pre-impresa: copia exacta del reporte repNotaFactura.jrxml / repNotaItemFactura.jrxml (iReport),
// que ya está calibrado al formulario. Hoja de 650 × 1000 pt, margen izquierdo 12 y superior 0. La banda de la factura
// mide 278 pt y se repite tres veces pegadas (original, duplicado y triplicado) en la misma hoja.
export const HOJA = { ancho: 650, alto: 1000, margenIzq: 12, margenSup: 0 };
export const ALTO_COPIA = 278;
export const COPIAS = 3;
// Subreporte de ítems: arranca en (1, 81) de la banda, 108 pt de alto y renglones de 9 pt → 12 renglones.
const ITEMS = { x: 1, y: 81, alto: 108, renglon: 9 };
export const MAX_LINEAS = Math.floor(ITEMS.alto / ITEMS.renglon);

const entero = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conPatron = (valor, patron) => (patron === '#,##0.00' ? decimal : entero).format(Number(valor || 0));

const pad = value => String(value).padStart(2, '0');
const timeZone = process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion';
// to_char(fecha,'yyyy-MM-dd') del reporte original, en la hora del restaurante.
function fechaEmision(value) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${partes.year}-${pad(partes.month)}-${pad(partes.day)}`;
}

// El formulario no tiene columna de descuento: cada renglón lleva el precio neto, y los productos iguales
// (misma descripción y mismo precio) se juntan en un renglón para ahorrar espacio.
export function lineasImpresas(detalles = []) {
  const grupos = new Map();
  for (const line of detalles) {
    const unitario = Number(line.precio_unitario) - Number(line.descuento || 0);
    const clave = `${line.descripcion}\u0000${unitario}`;
    const actual = grupos.get(clave) || { descripcion: line.descripcion, cantidad: 0, precio_unitario: unitario, subtotal: 0 };
    actual.cantidad += Number(line.cantidad);
    actual.subtotal += Number(line.subtotal);
    grupos.set(clave, actual);
  }
  return [...grupos.values()];
}

// Datos que imprime la factura, con los mismos nombres de campo del reporte original.
export function camposFactura(factura) {
  const cliente = factura.fk_idcliente ? `${factura.fk_idcliente}-${factura.cliente_razon_social}` : factura.cliente_razon_social;
  return {
    nro: factura.numero,
    condicion: 'CONTADO',
    emision: fechaEmision(factura.fecha_emision),
    ttletra: factura.total_letra || '',
    ttpagar: Number(factura.total),
    ttiva5: 0,
    ttiva10: Number(factura.total_iva10),
    ttiva: Number(factura.total_iva10),
    ruc: factura.cliente_ruc || '',
    cliente,
    telef: factura.cliente_celular || '',
    direc: factura.cliente_direccion || '',
    items: lineasImpresas(factura.detalles)
  };
}

// Campos de la banda (x, y, ancho, alto relativos a la banda), tal cual el jrxml.
const CABECERA = [
  { campo: 'nro', x: 68, y: 11, w: 25, h: 11, size: 8, borde: true },
  { campo: 'condicion', x: 68, y: 22, w: 25, h: 11, size: 8, borde: true },
  { campo: 'emision', x: 255, y: 10, w: 65, h: 12, size: 9 },
  { campo: 'ruc', x: 373, y: 10, w: 61, h: 12, size: 9 },
  { campo: 'cliente', x: 259, y: 22, w: 179, h: 10, size: 7 },
  { campo: 'direc', x: 270, y: 33, w: 164, h: 10, size: 7 },
  { campo: 'telef', x: 283, y: 43, w: 60, h: 11, size: 8 },
  { campo: 'ttiva5', x: 83, y: 228, w: 35, h: 11, size: 8, borde: true, derecha: true, padDer: 2, patron: '#,##0' },
  { campo: 'ttiva10', x: 143, y: 228, w: 52, h: 11, size: 8, borde: true, derecha: true, padDer: 2, patron: '#,##0.00' },
  { campo: 'ttiva', x: 245, y: 228, w: 56, h: 11, size: 8, borde: true, derecha: true, padDer: 2, patron: '#,##0.00' },
  { campo: 'ttletra', x: 118, y: 239, w: 290, h: 11, size: 8 },
  { campo: 'ttpagar', x: 480, y: 237, w: 78, h: 13, size: 10, borde: true, derecha: true, padDer: 2, patron: '#,##0' }
];
// Columnas del subreporte de ítems (x relativo al subreporte).
const COLUMNAS = [
  { campo: 'cantidad', x: 37, w: 25, size: 7, negrita: true, patron: '#,##0' },
  { campo: 'descripcion', x: 74, w: 226, size: 6 },
  { campo: 'precio_unitario', x: 308, w: 52, size: 7, negrita: true, derecha: true, patron: '#,##0' },
  { campo: 'subtotal', x: 482, w: 73, size: 7, negrita: true, derecha: true, patron: '#,##0' }
];

// Un textField de Jasper: texto en una línea, recortado a su caja, opcionalmente con recuadro de 0,5 pt.
function campo(doc, valor, { x, y, w, h, size, negrita = false, derecha = false, padDer = 0, borde = false, patron }) {
  const texto = valor === null || valor === undefined ? '' : patron ? conPatron(valor, patron) : String(valor);
  if (borde) doc.save().lineWidth(.5).strokeColor('#000000').rect(x, y, w, h).stroke().restore();
  if (!texto) return;
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
  const left = derecha ? x + w - padDer - doc.widthOfString(texto) : x;
  doc.save().rect(x, y, w, h).clip();
  doc.fillColor('#000000').text(texto, left, y, { lineBreak: false });
  doc.restore();
}

function copia(doc, datos, top) {
  const X = HOJA.margenIzq;
  // Línea de 100 pt arriba de la banda (está en el reporte original).
  doc.save().lineWidth(1).strokeColor('#000000').moveTo(X + 108, top + .5).lineTo(X + 208, top + .5).stroke().restore();
  for (const def of CABECERA) campo(doc, datos[def.campo], { ...def, x: X + def.x, y: top + def.y });
  datos.items.slice(0, MAX_LINEAS).forEach((item, index) => {
    const y = top + ITEMS.y + index * ITEMS.renglon;
    for (const def of COLUMNAS) campo(doc, item[def.campo], { ...def, x: X + ITEMS.x + def.x, y, h: ITEMS.renglon });
  });
}

// PDF de una hoja con las tres copias de la factura.
export function renderFacturaPreimpresa(datos, titulo = 'Factura') {
  const doc = new PDFDocument({ size: [HOJA.ancho, HOJA.alto], margin: 0, compress: true, info: { Title: titulo, Author: 'Restaurante Web' } });
  for (let i = 0; i < COPIAS; i += 1) copia(doc, datos, HOJA.margenSup + i * ALTO_COPIA);
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.end();
  });
}

// Hoja de calibración: todos los campos y los 12 renglones llenos, con datos de ejemplo.
export function datosEjemplo() {
  const items = Array.from({ length: MAX_LINEAS }, (_, i) => ({
    cantidad: i + 1, descripcion: i === 0 ? 'RENGLÓN 1 · DESCRIPCIÓN LARGA PARA VER DÓNDE SE CORTA EL TEXTO DEL PRODUCTO' : `RENGLÓN ${i + 1} · PRODUCTO DE EJEMPLO`,
    precio_unitario: 10000, subtotal: (i + 1) * 10000
  }));
  return {
    nro: 1234567, condicion: 'CONTADO', emision: fechaEmision(new Date()), ttletra: 'SETECIENTOS OCHENTA MIL',
    ttpagar: 780000, ttiva5: 0, ttiva10: 70909, ttiva: 70909, ruc: '80012345-6', cliente: '123-CLIENTE DE PRUEBA SA',
    telef: '0981 123 456', direc: 'CALLE DE PRUEBA 1234 C/ OTRA CALLE', items
  };
}
