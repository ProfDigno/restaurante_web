import { PdfReport, change, integer, isoToText } from './report-pdf.js';
import { money } from './ticket-pdf.js';
import { entregaLabel } from './kpi-pedidos.js';

// Reporte A4 del Análisis de pedidos: indicadores, gráficos, rankings y detalle de pedidos del período.
const estadoTexto = estado => ({ cancelado: 'Anulado', pagado: 'Pagado', confirmado: 'Confirmado', en_preparacion: 'Cocina', listo: 'Terminado', entregado: 'Entregado' })[estado] || estado;
export const quien = p => p.tipo_entrega === 'COMER_ACA' && p.mesa ? `Mesa ${p.mesa}${p.cliente ? ` · ${p.cliente}` : ''}` : [p.cliente, p.zona].filter(Boolean).join(' · ') || '—';

export function renderKpiPedidosPdf(data, restaurante, printedAt = new Date()) {
  const s = data.resumen;
  const report = new PdfReport({ title: 'Análisis de pedidos', inicio: data.inicio, fin: data.fin, restaurante, printedAt });
  report.cards([
    ['Ventas confirmadas', money(s.monto), `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Pedidos', integer(s.pedidos), `${change(s.pedidos, s.anterior.pedidos)} vs. período anterior`],
    ['Ticket promedio', money(s.ticket_promedio), 'Venta total / pedidos'],
    ['Clientes nuevos', integer(s.clientes_nuevos), 'Primera compra confirmada'],
    ['Anulados', integer(s.anulados.cantidad), `${money(s.anulados.monto)} · separado del total`]
  ]);
  report.dailyChart('Evolución diaria', 'Monto confirmado por día', data.dias);
  report.hbars('Tipos de entrega', 'Venta por modalidad (pedidos entre paréntesis)', data.entregas.map(r => ({ ...r, nombre: `${entregaLabel(r.nombre)} (${integer(r.pedidos)})` })), s.monto);
  const cobros = data.pagos.reduce((a, r) => a + r.monto, 0);
  report.hbars('Cobros por forma de pago', 'Pagos aprobados menos devoluciones, por fecha de cobro', data.pagos, cobros);
  report.hbars('Días de la semana', 'Ventas acumuladas por día', data.semana, s.monto, { single: true });
  const ranking = rows => rows.map(r => ({ ...r, extra: `${integer(r.unidades)} u.` }));
  const note = 'Top 10 por unidades vendidas, con su importe de líneas';
  report.hbars('Productos más vendidos', note, ranking(data.productos), 0, { single: true });
  report.hbars('Categorías más vendidas', note, ranking(data.categorias), 0, { single: true });
  report.hbars('Grupos más vendidos', note, ranking(data.grupos), 0, { single: true });
  report.hbars('Mesas más usadas', 'Top 10 por cantidad de pedidos (entre paréntesis)', data.mesas.map(r => ({ ...r, nombre: `Mesa ${r.nombre} (${integer(r.pedidos)})` })), s.monto, { single: true });
  report.hbars('Zonas de delivery', 'Top 10 por cantidad de pedidos (entre paréntesis)', data.zonas.map(r => ({ ...r, nombre: `${r.nombre} (${integer(r.pedidos)})` })), s.monto, { single: true });

  report.ensure(160);
  report.heading(`Detalle de pedidos (${integer(data.lista.length)})`, `Pedidos confirmados del ${isoToText(data.inicio)} al ${isoToText(data.fin)}, por fecha de confirmación. Los anulados no suman al total.`);
  const totals = [[`TOTAL VENTAS CONFIRMADAS (${integer(s.pedidos)})`, money(s.monto), true]];
  if (s.anulados.cantidad) totals.push([`Anulados, no suman (${integer(s.anulados.cantidad)})`, money(s.anulados.monto), false]);
  report.table({
    cols: [
      { key: 'fecha', label: 'Fecha', w: 70 }, { key: 'idpedido', label: '#', w: 34, align: 'right' }, { key: 'entrega', label: 'Entrega', w: 58 },
      { key: 'quien', label: 'Mesa / cliente', wrap: true }, { key: 'estado', label: 'Estado', w: 58 },
      { key: 'ajustes', label: 'Desc. / recargo', w: 80, align: 'right' }, { key: 'monto', label: 'Total', w: 68, align: 'right' }
    ],
    rows: data.lista.map(p => ({
      ...p, fecha: `${isoToText(p.fecha)} ${p.hora}`, entrega: entregaLabel(p.tipo_entrega), quien: quien(p), estado: estadoTexto(p.estado),
      ajustes: p.descuento || p.recargo ? `${p.descuento ? `-${integer(p.descuento)}` : ''}${p.descuento && p.recargo ? ' / ' : ''}${p.recargo ? `+${integer(p.recargo)}` : ''}` : '—',
      monto: money(p.monto), _dim: p.estado === 'cancelado'
    })),
    dimmed: row => row._dim,
    totals
  });
  return report.finish();
}
