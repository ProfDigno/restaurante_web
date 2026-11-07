import { PdfReport, change, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';

// Reporte A4 del Análisis de rentabilidad: indicadores, margen por categoría y producto, y detalle completo.
const percent = value => `${value.toFixed(1)}%`;

export function renderKpiRentabilidadPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Análisis de rentabilidad', inicio: data.inicio, fin: data.fin, restaurante, filtro: data.filtro, printedAt });
  report.cards([
    ['Venta de productos', money(s.venta), `${change(s.venta, s.anterior.venta)} vs. período anterior`],
    ['Costo', money(s.costo), `${percent(s.venta ? s.costo / s.venta * 100 : 0)} de la venta`],
    ['Margen bruto', money(s.margen), `${percent(s.margen_pct)} · ${change(s.margen, s.anterior.margen)} vs. anterior`],
    s.margen_neto === null
      ? ['Unidades vendidas', integer(s.unidades), `${integer(s.pedidos)} pedidos`]
      : ['Margen neto', money(s.margen_neto), `Descuentos: ${money(s.descuentos)}`]
  ]);
  if (s.productos_con_perdida) {
    report.heading('Atención: productos vendidos con pérdida',
      `${integer(s.productos_con_perdida)} productos tienen un costo mayor que su venta (pérdida de ${money(Math.abs(s.perdida))}). Figuran con margen negativo en el detalle.`);
  }
  if (s.productos_costo_sospechoso) {
    report.heading('Atención: costos sospechosamente bajos',
      `${integer(s.productos_costo_sospechoso)} productos (${money(s.venta_costo_sospechoso)} de venta) tienen un costo menor al 1% de su venta, por ejemplo precio de compra de 1 Gs. Su margen figura cerca del 100%.`);
  }
  if (s.productos_sin_costo) {
    report.heading('Atención: ventas sin costo cargado',
      `${integer(s.productos_sin_costo)} productos tienen ventas con costo 0 (${money(s.venta_sin_costo)} de venta). Esas ventas cuentan como 100% de margen y suben el margen total. Cargá el precio de compra en Productos del menú.`);
  }
  const bars = rows => rows.filter(r => r.margen > 0).map(r => ({ nombre: r.etiqueta || r.nombre, monto: r.margen, extra: percent(r.margen_pct) }));
  report.hbars('Margen por categoría', 'Margen bruto (y % sobre su venta)', bars(data.categorias), s.margen);
  report.hbars('Productos que más margen dejan', 'Diez productos con mayor margen bruto', bars(data.productos.slice(0, 10)), s.margen);
  const lowest = data.productos.filter(r => !r.sin_costo && !r.costo_sospechoso && r.venta > 0).sort((a, b) => a.margen_pct - b.margen_pct).slice(0, 10);
  report.hbars('Productos con menor margen %', 'Diez productos con costo cargado y menor margen sobre su venta', lowest.map(r => ({ nombre: r.etiqueta, monto: Math.max(r.margen, 0), extra: percent(r.margen_pct) })), 0);

  report.ensure(160);
  report.heading(`Detalle por producto (${integer(data.productos.length)})`, `Del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, ordenado por margen. "Sin costo": ninguna venta con costo · "Incompleto": algunas ventas sin costo · "Sospechoso": costo menor al 1% de la venta · "Estimado": costo calculado con el precio actual del ingrediente.`);
  report.table({
    cols: [
      { key: 'nombre', label: 'Producto', wrap: true }, { key: 'categoria', label: 'Categoría', w: 80 },
      { key: 'unidades', label: 'Unid.', w: 34, align: 'right' }, { key: 'venta', label: 'Venta', w: 62, align: 'right' },
      { key: 'costo', label: 'Costo', w: 62, align: 'right' }, { key: 'margen', label: 'Margen', w: 62, align: 'right' },
      { key: 'margen_pct', label: '%', w: 38, align: 'right' }, { key: 'nota', label: 'Nota', w: 46 }
    ],
    rows: data.productos.map(r => ({ ...r, unidades: integer(r.unidades), venta: money(r.venta), costo: money(r.costo), margen: money(r.margen),
      margen_pct: percent(r.margen_pct), nota: r.sin_costo ? 'Sin costo' : r.costo_incompleto ? 'Incompleto' : r.costo_sospechoso ? 'Sospechoso' : r.estimado ? 'Estimado' : '' })),
    dimmed: row => row.nota === 'Sin costo',
    totals: [
      ['VENTA DE PRODUCTOS', money(s.venta), false], ['COSTO', money(s.costo), false], [`MARGEN BRUTO (${percent(s.margen_pct)})`, money(s.margen), true],
      ...(s.margen_neto === null ? [] : [['Descuentos de pedidos', money(s.descuentos), false], ['MARGEN NETO', money(s.margen_neto), true]])
    ]
  });
  return report.finish();
}
