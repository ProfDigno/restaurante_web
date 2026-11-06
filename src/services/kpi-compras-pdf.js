import { PdfReport, change, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';

// Reporte A4 del Análisis de compras: indicadores, gráficos y detalle de las compras del período.
const estadoTexto = c => c.estado === 'cancelada' ? 'Cancelada' : c.estado === 'borrador' ? 'Borrador' : c.saldo > 0 ? 'Pendiente' : 'Pagada';

export function renderKpiComprasPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Análisis de compras', inicio: data.inicio, fin: data.fin, restaurante, filtro: data.filtro, printedAt });
  report.cards([
    ['Total comprado', money(s.monto), `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Compras recibidas', integer(s.cantidad), `${change(s.cantidad, s.anterior.cantidad)} vs. período anterior`],
    ['Compra promedio', money(s.promedio), 'Total / compras recibidas'],
    ['Saldo pendiente', money(s.saldo), `${integer(s.pendientes)} compras con saldo · pagado ${money(s.pagado)}`],
    ['Canceladas', integer(s.canceladas.cantidad), `${money(s.canceladas.monto)} · separado del total`],
    ['Borradores', integer(s.borradores.cantidad), `${money(s.borradores.monto)} estimado · sin recibir`]
  ]);
  report.dailyChart('Evolución diaria', 'Importe de compras recibidas por día', data.dias);
  const conCantidad = (rows, word) => rows.map(r => ({ ...r, nombre: `${r.nombre} (${integer(r.cantidad)}${word ? ` ${word}` : ''})` }));
  report.hbars('Proveedores', 'Importe comprado por proveedor (cantidad de compras entre paréntesis)', conCantidad(data.proveedores), s.monto);
  report.hbars('Contado y crédito', 'Importe por condición de compra', conCantidad(data.condiciones), s.monto);
  report.hbars('Formas de pago', 'Pagos registrados de las compras del período', conCantidad(data.formas, 'pagos'), s.pagado);
  report.hbars('Productos más comprados', 'Diez productos con mayor importe y sus unidades compradas', data.productos.map(p => ({ ...p, extra: `${integer(p.unidades)} u.` })), s.monto, { single: true });
  report.hbars('Días de la semana', 'Importe acumulado por día de la semana', data.semana, s.monto, { single: true });

  report.ensure(160);
  report.heading(`Detalle de compras (${integer(data.compras.length)})`, `Compras del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, ordenadas por fecha. Solo las recibidas suman al total; borradores y canceladas se muestran atenuados.`);
  const totals = [
    [`TOTAL COMPRAS RECIBIDAS (${integer(s.cantidad)})`, money(s.monto), true],
    ['Pagado', money(s.pagado), false],
    ['Saldo pendiente', money(s.saldo), false]
  ];
  if (s.canceladas.cantidad) totals.push([`Canceladas, no suman (${integer(s.canceladas.cantidad)})`, money(s.canceladas.monto), false]);
  if (s.borradores.cantidad) totals.push([`Borradores, no suman (${integer(s.borradores.cantidad)})`, money(s.borradores.monto), false]);
  report.table({
    cols: [
      { key: 'fecha', label: 'Fecha', w: 52 }, { key: 'idcompra', label: '#', w: 28, align: 'right' },
      { key: 'proveedor', label: 'Proveedor', wrap: true }, { key: 'numero_nota', label: 'Nota', w: 62 },
      { key: 'condicion', label: 'Condición', w: 50 }, { key: 'estado', label: 'Estado', w: 52 },
      { key: 'monto', label: 'Total', w: 62, align: 'right' }, { key: 'saldo', label: 'Saldo', w: 58, align: 'right' }
    ],
    rows: data.compras.map(c => ({ ...c, fecha: isoToText(c.fecha), numero_nota: c.numero_nota || '—', estado: estadoTexto(c), monto: money(c.monto), saldo: c.estado === 'recibida' ? money(c.saldo) : '—', _dim: c.estado !== 'recibida' })),
    dimmed: row => row._dim,
    totals
  });
  return report.finish();
}
