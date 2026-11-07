import { PdfReport, change, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';

// Reporte A4 del Análisis de vales: indicadores, gráficos, resumen por persona y detalle de los vales del período.
const percent = value => value === null ? '—' : `${value.toFixed(1)}%`;
const pagoLabel = { DIARIO: 'diario', SEMANAL: 'semanal', QUINCENAL: 'quincenal', MENSUAL: 'mensual' };

export function renderKpiValesPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Análisis de vales', inicio: data.inicio, fin: data.fin, restaurante, filtro: data.filtro, printedAt });
  report.cards([
    ['Total en vales', money(s.monto), `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Vales pagados', integer(s.cantidad), `${integer(s.personas)} personas · ${change(s.cantidad, s.anterior.cantidad)} vs. anterior`],
    ['Vale promedio', money(s.promedio), 'Total / vales pagados'],
    ['Del sueldo del período', percent(s.pct_sueldo), s.pct_sueldo === null ? 'Sin sueldos cargados' : `Sobre ${money(s.sueldo_periodo)} (aprox.)`]
  ]);
  report.dailyChart('Evolución diaria', 'Importe de vales pagados por día', data.dias);
  const conCantidad = rows => rows.map(r => ({ ...r, nombre: `${r.nombre} (${integer(r.cantidad)})` }));
  report.hbars('Vales por persona', 'Importe por persona (cantidad de vales entre paréntesis)', conCantidad(data.personas), s.monto);
  report.hbars('Vales por cargo', 'Importe por cargo', conCantidad(data.cargos), s.monto);
  report.hbars('Formas de pago', 'Importe por forma de pago', conCantidad(data.formas), s.monto);
  report.hbars('Días de la semana', 'Importe acumulado por día de la semana', data.semana, s.monto, { single: true });

  report.ensure(140);
  report.heading(`Resumen por persona (${integer(data.personas.length)})`, `"% del sueldo": vales del período sobre el sueldo de ${integer(data.dias_periodo)} días según su tipo de pago (aproximado, días corridos).`);
  report.table({
    cols: [
      { key: 'nombre', label: 'Persona', wrap: true }, { key: 'cargo', label: 'Cargo', w: 80 },
      { key: 'cantidad', label: 'Vales', w: 36, align: 'right' }, { key: 'monto', label: 'Total', w: 70, align: 'right' },
      { key: 'promedio', label: 'Promedio', w: 64, align: 'right' }, { key: 'sueldo', label: 'Sueldo', w: 88, align: 'right' },
      { key: 'pct', label: '% sueldo', w: 46, align: 'right' }
    ],
    rows: data.personas.map(p => ({ ...p, cargo: p.cargo || '—', cantidad: integer(p.cantidad), monto: money(p.monto), promedio: money(p.promedio),
      sueldo: p.monto_pago ? `${money(p.monto_pago)} ${pagoLabel[p.tipo_pago] || ''}` : 'Sin cargar', pct: percent(p.pct_sueldo) })),
    totals: [[`TOTAL (${integer(s.cantidad)} vales)`, money(s.monto), true]]
  });

  report.ensure(160);
  report.heading(`Detalle de vales (${integer(data.vales.length)})`, `Vales del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, ordenados por fecha. Los anulados no suman al total.`);
  const totals = [[`TOTAL VALES PAGADOS (${integer(s.cantidad)})`, money(s.monto), true]];
  if (s.anulados.cantidad) totals.push([`Anulados, no suman (${integer(s.anulados.cantidad)})`, money(s.anulados.monto), false]);
  report.table({
    cols: [
      { key: 'fecha', label: 'Fecha', w: 52 }, { key: 'idvale', label: '#', w: 30, align: 'right' }, { key: 'personal', label: 'Persona', w: 100 },
      { key: 'descripcion', label: 'Concepto', wrap: true }, { key: 'forma_pago', label: 'Forma de pago', w: 70 },
      { key: 'estado', label: 'Estado', w: 45 }, { key: 'monto', label: 'Importe', w: 68, align: 'right' }
    ],
    rows: data.vales.map(v => ({ ...v, fecha: isoToText(v.fecha), estado: v.estado === 'anulado' ? 'Anulado' : 'Pagado', monto: money(v.monto) })),
    dimmed: row => row.estado === 'Anulado',
    totals
  });
  return report.finish();
}
