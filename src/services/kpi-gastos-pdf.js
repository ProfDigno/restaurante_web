import { PdfReport, change, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';

// Reporte A4 del Análisis de gastos: indicadores, gráficos y detalle de los gastos del período.
export function renderKpiGastosPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Análisis de gastos', inicio: data.inicio, fin: data.fin, restaurante, filtro: data.filtro, printedAt });
  report.cards([
    ['Gasto total', money(s.monto), `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Gastos pagados', integer(s.cantidad), `${change(s.cantidad, s.anterior.cantidad)} vs. período anterior`],
    ['Gasto promedio', money(s.promedio), 'Total / gastos pagados'],
    ['Anulados', integer(s.anulados.cantidad), `${money(s.anulados.monto)} · separado del total`]
  ]);
  report.dailyChart('Evolución diaria', 'Importe de gastos pagados por día', data.dias);
  const conCantidad = rows => rows.map(r => ({ ...r, nombre: `${r.nombre} (${integer(r.cantidad)})` }));
  report.hbars('Tipos de gasto', 'Importe por tipo (cantidad de gastos entre paréntesis)', conCantidad(data.tipos), s.monto);
  report.hbars('Formas de pago', 'Importe por forma de pago', conCantidad(data.formas), s.monto);
  report.hbars('Días de la semana', 'Importe acumulado por día de la semana', data.semana, s.monto, { single: true });

  report.ensure(160);
  report.heading(`Detalle de gastos (${integer(data.gastos.length)})`, `Gastos registrados del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, ordenados por fecha. Los anulados no suman al total.`);
  const totals = [[`TOTAL GASTOS PAGADOS (${integer(s.cantidad)})`, money(s.monto), true]];
  if (s.anulados.cantidad) totals.push([`Anulados, no suman (${integer(s.anulados.cantidad)})`, money(s.anulados.monto), false]);
  report.table({
    cols: [
      { key: 'fecha', label: 'Fecha', w: 52 }, { key: 'idgasto', label: '#', w: 30, align: 'right' }, { key: 'tipo', label: 'Tipo', w: 88 },
      { key: 'descripcion', label: 'Descripción', wrap: true }, { key: 'forma_pago', label: 'Forma de pago', w: 70 },
      { key: 'estado', label: 'Estado', w: 45 }, { key: 'monto', label: 'Importe', w: 68, align: 'right' }
    ],
    rows: data.gastos.map(g => ({ ...g, fecha: isoToText(g.fecha), estado: g.estado === 'anulado' ? 'Anulado' : 'Pagado', monto: money(g.monto) })),
    dimmed: row => row.estado === 'Anulado',
    totals
  });
  return report.finish();
}
