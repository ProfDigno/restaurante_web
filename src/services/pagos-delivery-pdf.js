import { PdfReport, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';

// Reporte A4 de Pagos a delivery: indicadores, pendiente por entregador, pedidos del período y pagos realizados.
export function renderPagosDeliveryPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Pagos a delivery', inicio: data.inicio, fin: data.fin, restaurante, filtro: data.filtro, printedAt });
  report.cards([
    ['Delivery del período', money(s.total), `${integer(s.pedidos)} pedidos con entregador`],
    ['Ya pagado', money(s.pagado), 'Pagado a los entregadores'],
    ['Pendiente de pagar', money(s.pendiente), 'Se le debe a los entregadores'],
    ['Sin entregador', money(s.sin_entregador.total), `${integer(s.sin_entregador.pedidos)} pedidos sin asignar`]
  ]);
  report.hbars('Pendiente por entregador', 'Delivery pendiente de pagar (pedidos entre paréntesis)',
    data.entregadores.map(e => ({ nombre: `${e.nombre} (${integer(e.pendientes)})`, monto: e.pendiente })), s.pendiente);

  report.ensure(160);
  report.heading(`Pedidos delivery (${integer(data.pedidos.length)})`, `Del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, por fecha de confirmación. Sin anulados.`);
  report.table({
    cols: [
      { key: 'fecha', label: 'Fecha', w: 52 }, { key: 'idpedido', label: '#', w: 34, align: 'right' }, { key: 'entregador', label: 'Entregador', w: 90 },
      { key: 'cliente', label: 'Cliente', wrap: true }, { key: 'zona_nombre', label: 'Zona', w: 70 },
      { key: 'situacion', label: 'Situación', w: 58 }, { key: 'monto', label: 'Delivery', w: 62, align: 'right' }
    ],
    rows: data.pedidos.map(p => ({ ...p, fecha: isoToText(p.fecha), zona_nombre: p.zona_nombre || '—', situacion: p.pagado ? 'Pagado' : 'Pendiente', monto: money(p.monto_delivery) })),
    dimmed: row => row.situacion === 'Pagado',
    totals: [['PENDIENTE DE PAGAR', money(s.pendiente), true], ['Ya pagado', money(s.pagado), false]]
  });

  if (data.sin_entregador.length) {
    report.ensure(120);
    report.heading(`Pedidos sin entregador (${integer(data.sin_entregador.length)})`, 'No se le pueden pagar a nadie hasta asignarles entregador.');
    report.table({
      cols: [{ key: 'fecha', label: 'Fecha', w: 52 }, { key: 'idpedido', label: '#', w: 34, align: 'right' }, { key: 'cliente', label: 'Cliente', wrap: true },
        { key: 'zona_nombre', label: 'Zona', w: 90 }, { key: 'monto', label: 'Delivery', w: 62, align: 'right' }],
      rows: data.sin_entregador.map(p => ({ ...p, fecha: isoToText(p.fecha), zona_nombre: p.zona_nombre || '—', monto: money(p.monto_delivery) })),
      totals: [['TOTAL SIN ENTREGADOR', money(s.sin_entregador.total), true]]
    });
  }

  if (data.pagos.length) {
    report.ensure(120);
    report.heading(`Pagos realizados (${integer(data.pagos.length)})`, 'Pagos registrados en el período. Los anulados volvieron a la caja.');
    report.table({
      cols: [{ key: 'fecha', label: 'Fecha', w: 70 }, { key: 'idpago_delivery', label: '#', w: 30, align: 'right' }, { key: 'entregador', label: 'Entregador', wrap: true },
        { key: 'periodo', label: 'Período', w: 100 }, { key: 'cantidad_pedidos', label: 'Ped.', w: 30, align: 'right' },
        { key: 'estado', label: 'Estado', w: 48 }, { key: 'monto', label: 'Total', w: 62, align: 'right' }],
      rows: data.pagos.map(p => ({ ...p, periodo: `${isoToText(p.fecha_desde)} al ${isoToText(p.fecha_hasta)}`, estado: p.estado === 'anulado' ? 'Anulado' : 'Pagado', monto: money(p.total) })),
      dimmed: row => row.estado === 'Anulado'
    });
  }
  return report.finish();
}
