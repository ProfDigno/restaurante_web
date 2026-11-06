import PDFDocument from 'pdfkit';
import { money, dateTime } from './ticket-pdf.js';

// Reporte A4 con indicadores, gráficos vectoriales y tablas paginadas (lo usan Análisis de gastos y de compras).
const PAGE = { width: 595.28, height: 841.89 };
const M = 36;
export const REPORT_WIDTH = PAGE.width - M * 2;
const BOTTOM = PAGE.height - M - 14;
const ink = '#17201f', muted = '#5b6b65', line = '#dfe5e2', soft = '#f4f7f6';
export const colors = ['#d07a55', '#4f83c4', '#66aa8b', '#ab84be', '#d9a440', '#639ba8', '#dc7891'];
export const integer = value => new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 }).format(Number(value || 0));
export const isoToText = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
export const change = (current, previous) => previous ? `${current >= previous ? '+' : ''}${((current - previous) / previous * 100).toFixed(1)}%` : current ? 'Nuevo' : '0%';
const short = value => {
  const n = Number(value || 0);
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('es-PY', { maximumFractionDigits: 1 })} M`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('es-PY', { maximumFractionDigits: 0 })} mil`;
  return integer(n);
};

// Recorta el texto con "…" para que entre en una línea del ancho dado (con la fuente actual).
function fit(doc, value, width) {
  let text = String(value ?? '');
  if (doc.widthOfString(text) <= width) return text;
  while (text.length > 1 && doc.widthOfString(`${text}…`) > width) text = text.slice(0, -1);
  return `${text.trimEnd()}…`;
}

export class PdfReport {
  constructor({ title, inicio, fin, restaurante, filtro = null, printedAt = new Date() }) {
    this.title = title; this.inicio = inicio; this.fin = fin;
    this.doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, compress: true, info: { Title: `${title} ${inicio} a ${fin}`, Author: 'Restaurante Web' } });
    this.y = M;
    const doc = this.doc;
    const nombre = restaurante?.nombre_fantasia || restaurante?.razon_social;
    if (nombre) { doc.font('Helvetica').fontSize(9).fillColor(muted).text(nombre, M, this.y); this.y += 13; }
    doc.font('Helvetica-Bold').fontSize(20).fillColor(ink).text(title, M, this.y); this.y += 26;
    doc.font('Helvetica').fontSize(9.5).fillColor(muted).text(`Período: ${isoToText(inicio)} al ${isoToText(fin)}   ·   Generado: ${dateTime(printedAt)}`, M, this.y);
    this.y += 14;
    if (filtro) { doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#d26d4f').text(`Filtro · ${filtro}`, M, this.y); this.y += 14; }
    this.y += 8;
  }
  ensure(height) { if (this.y + height > BOTTOM) { this.doc.addPage(); this.y = M; } }
  newPage() { this.doc.addPage(); this.y = M; }
  heading(title, subtitle) {
    this.ensure(40);
    this.doc.font('Helvetica-Bold').fontSize(12).fillColor(ink).text(title, M, this.y);
    this.y += 15;
    if (subtitle) { this.doc.font('Helvetica').fontSize(8).fillColor(muted).text(subtitle, M, this.y, { width: REPORT_WIDTH }); this.y += 12; }
    this.y += 4;
  }
  empty(height) {
    this.ensure(height);
    this.doc.roundedRect(M, this.y, REPORT_WIDTH, height, 6).fill(soft);
    this.doc.font('Helvetica').fontSize(9).fillColor(muted).text('Sin datos en este período', M, this.y + height / 2 - 5, { width: REPORT_WIDTH, align: 'center' });
    this.y += height + 14;
  }
  // cards: [[etiqueta, valor, nota], ...] en filas de 4.
  cards(list) {
    const doc = this.doc, cw = (REPORT_WIDTH - 3 * 8) / 4;
    for (let start = 0; start < list.length; start += 4) {
      this.ensure(66);
      list.slice(start, start + 4).forEach(([label, value, note], i) => {
        const x = M + i * (cw + 8);
        doc.roundedRect(x, this.y, cw, 58, 7).fill(soft);
        doc.font('Helvetica').fontSize(7.5).fillColor(muted).text(label, x + 9, this.y + 8, { width: cw - 18 });
        doc.font('Helvetica-Bold').fontSize(12.5).fillColor(ink).text(value, x + 9, this.y + 21, { width: cw - 18 });
        doc.font('Helvetica').fontSize(6.5).fillColor(muted).text(note, x + 9, this.y + 40, { width: cw - 18 });
      });
      this.y += 66;
    }
    this.y += 6;
  }
  // Barras verticales por día (dias: [{fecha:'YYYY-MM-DD', monto}]).
  dailyChart(title, subtitle, dias) {
    this.heading(title, subtitle);
    const doc = this.doc;
    const max = Math.max(...dias.map(d => d.monto), 0);
    if (!max) return this.empty(120);
    const h = 140;
    this.ensure(h + 34);
    const left = M + 46, cwid = REPORT_WIDTH - 46, top = this.y + 6;
    // Escala con valores redondos (1, 2, 2,5 o 5 × 10^n por división).
    const raw = max / 4, pow = 10 ** Math.floor(Math.log10(raw));
    const stepValue = [1, 2, 2.5, 5, 10].map(f => f * pow).find(v => v >= raw);
    const ticks = Math.ceil(max / stepValue), scaleTop = stepValue * ticks;
    for (let t = 0; t <= ticks; t++) {
      const ty = top + h - (h * t / ticks);
      doc.moveTo(left, ty).lineTo(left + cwid, ty).lineWidth(.4).strokeColor(line).dash(2, { space: 3 }).stroke().undash();
      doc.font('Helvetica').fontSize(6.5).fillColor(muted).text(short(stepValue * t), M, ty - 3.5, { width: 42, align: 'right' });
    }
    const step = cwid / dias.length, bw = Math.max(1.5, Math.min(18, step * .7));
    dias.forEach((d, i) => {
      const bh = d.monto / scaleTop * h;
      if (bh > 0) doc.rect(left + i * step + (step - bw) / 2, top + h - bh, bw, bh).fill(colors[0]);
    });
    const every = Math.max(1, Math.ceil(dias.length / 12));
    dias.forEach((d, i) => {
      if (i % every) return;
      doc.font('Helvetica').fontSize(6.5).fillColor(muted).text(`${d.fecha.slice(8, 10)}/${d.fecha.slice(5, 7)}`, left + i * step + step / 2 - 15, top + h + 4, { width: 30, align: 'center' });
    });
    this.y = top + h + 24;
  }
  // Barras horizontales con importe y % del total (rows: [{nombre, monto}]).
  hbars(title, subtitle, rows, total, { single = false } = {}) {
    this.heading(title, subtitle);
    const doc = this.doc;
    const visible = rows.filter(r => r.monto > 0);
    if (!visible.length) return this.empty(50);
    const maxValue = Math.max(...visible.map(r => r.monto));
    const labelW = 150, valueW = 150, barW = REPORT_WIDTH - labelW - valueW - 12, rowH = 17;
    visible.forEach((r, i) => {
      this.ensure(rowH);
      doc.font('Helvetica').fontSize(8.5).fillColor(ink).text(fit(doc, r.nombre, labelW - 6), M, this.y + 3, { lineBreak: false });
      doc.roundedRect(M + labelW, this.y + 2, barW, 10, 3).fill(soft);
      doc.roundedRect(M + labelW, this.y + 2, Math.max(2, barW * r.monto / maxValue), 10, 3).fill(single ? colors[0] : colors[i % colors.length]);
      const pct = total ? ` · ${(r.monto / total * 100).toFixed(1)}%` : '';
      doc.font('Helvetica-Bold').fontSize(8).fillColor(ink).text(`${r.extra ? `${r.extra} · ` : ''}${money(r.monto)}${pct}`, M + labelW + barW + 6, this.y + 3, { width: valueW + 6, align: 'right', lineBreak: false });
      this.y += rowH;
    });
    this.y += 12;
  }
  // Tabla paginada. cols: [{key,label,w,align,wrap}]; dimmed(row) atenúa la fila; totals: [[etiqueta, valor, negrita]].
  table({ cols, rows, dimmed = () => false, totals = [] }) {
    const doc = this.doc;
    const fixed = cols.reduce((a, c) => a + (c.w || 0), 0);
    const flex = cols.filter(c => !c.w);
    const widths = cols.map(c => c.w || (REPORT_WIDTH - fixed) / flex.length);
    const header = () => {
      doc.rect(M, this.y, REPORT_WIDTH, 16).fill('#e9efec');
      let x = M;
      cols.forEach((c, i) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ink).text(c.label, x + 3, this.y + 4.5, { width: widths[i] - 6, align: c.align || 'left', lineBreak: false }); x += widths[i]; });
      this.y += 16;
    };
    if (!rows.length) return this.empty(40);
    this.ensure(40);
    header();
    rows.forEach((row, index) => {
      doc.font('Helvetica').fontSize(7.5);
      const h = Math.max(14, ...cols.map((c, i) => c.wrap ? doc.heightOfString(String(row[c.key] ?? ''), { width: widths[i] - 6 }) + 6 : 0));
      if (this.y + h > BOTTOM) { this.newPage(); header(); }
      if (index % 2) doc.rect(M, this.y, REPORT_WIDTH, h).fill('#fafbfa');
      let x = M;
      cols.forEach((c, i) => {
        doc.font('Helvetica').fontSize(7.5).fillColor(dimmed(row) ? muted : ink);
        const value = String(row[c.key] ?? '');
        doc.text(c.wrap ? value : fit(doc, value, widths[i] - 6), x + 3, this.y + 3.5, { width: widths[i] - 6, align: c.align || 'left', lineBreak: Boolean(c.wrap) });
        x += widths[i];
      });
      this.y += h;
    });
    this.ensure(18 + totals.length * 16);
    doc.moveTo(M, this.y).lineTo(M + REPORT_WIDTH, this.y).lineWidth(.8).strokeColor(ink).stroke();
    this.y += 6;
    for (const [label, value, bold] of totals) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 10 : 8.5).fillColor(bold ? ink : muted).text(label, M, this.y, { width: REPORT_WIDTH - 130, align: 'right' });
      doc.text(value, M + REPORT_WIDTH - 125, this.y, { width: 122, align: 'right' });
      this.y += bold ? 16 : 13;
    }
  }
  finish() {
    const doc = this.doc, range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font('Helvetica').fontSize(7).fillColor(muted).text(`${this.title} · ${isoToText(this.inicio)} al ${isoToText(this.fin)} · Página ${i + 1} de ${range.count}`, M, PAGE.height - M + 6, { width: REPORT_WIDTH, align: 'center', lineBreak: false });
    }
    return new Promise((resolve, reject) => {
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.end();
    });
  }
}
