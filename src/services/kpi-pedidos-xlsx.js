import ExcelJS from 'exceljs';
import { change, isoToText } from './report-pdf.js';
import { MONEY, toDate, styleHeaderRow, title, indicators, tableSection, dailySection, chartBuilders, addCharts } from './report-xlsx.js';
import { entregaLabel } from './kpi-pedidos.js';
import { quien } from './kpi-pedidos-pdf.js';

// Excel del Análisis de pedidos: hoja "Resumen" (indicadores, tablas y gráficos nativos) y hoja "Pedidos" (detalle con totales).
const RESUMEN = 'Resumen';
const estadoTexto = estado => ({ cancelado: 'Anulado', pagado: 'Pagado', confirmado: 'Confirmado', en_preparacion: 'Cocina', listo: 'Terminado', entregado: 'Entregado' })[estado] || estado;

export async function renderKpiPedidosXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  wb.created = new Date();

  const ws = wb.addWorksheet(RESUMEN, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 44 }, { width: 12 }, { width: 18 }, { width: 32 }, { width: 3 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  title(ws, 'Análisis de pedidos', `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)} · por fecha de confirmación`, restaurante);
  let r = indicators(ws, [
    ['Ventas confirmadas', s.monto, MONEY, `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Pedidos', s.pedidos, '#,##0', `${change(s.pedidos, s.anterior.pedidos)} vs. período anterior`],
    ['Ticket promedio', Math.round(s.ticket_promedio), MONEY, 'Venta total / pedidos'],
    ['Clientes nuevos', s.clientes_nuevos, '#,##0', 'Primera compra confirmada'],
    ['Anulados (cantidad)', s.anulados.cantidad, '#,##0', 'Separado del total'],
    ['Anulados (importe)', s.anulados.monto, MONEY, 'Separado del total'],
    ['Período anterior (importe)', s.anterior.monto, MONEY, 'Mismo número de días, inmediatamente antes']
  ]);
  const cobrosTotal = data.pagos.reduce((a, x) => a + x.monto, 0);
  const asCount = (rows, key, label = x => x.nombre) => rows.map(x => ({ nombre: label(x), cantidad: x[key], monto: x.monto }));
  const entregas = tableSection(ws, r, 'Tipos de entrega', asCount(data.entregas, 'pedidos', x => entregaLabel(x.nombre)), s.monto, { countLabel: 'Pedidos' }); r = entregas.next;
  const pagos = tableSection(ws, r, 'Cobros por forma de pago (pagos aprobados menos devoluciones)', asCount(data.pagos, 'movimientos'), cobrosTotal, { countLabel: 'Movimientos' }); r = pagos.next;
  const semana = tableSection(ws, r, 'Días de la semana', asCount(data.semana, 'pedidos'), s.monto, { countLabel: 'Pedidos' }); r = semana.next;
  const productos = tableSection(ws, r, 'Productos más vendidos (top 10 por unidades)', asCount(data.productos, 'unidades'), s.monto, { countLabel: 'Unidades' }); r = productos.next;
  const categorias = tableSection(ws, r, 'Categorías más vendidas (top 10)', asCount(data.categorias, 'unidades'), s.monto, { countLabel: 'Unidades' }); r = categorias.next;
  const grupos = tableSection(ws, r, 'Grupos más vendidos (top 10)', asCount(data.grupos, 'unidades'), s.monto, { countLabel: 'Unidades' }); r = grupos.next;
  const mesas = tableSection(ws, r, 'Mesas más usadas (top 10)', asCount(data.mesas, 'pedidos', x => `Mesa ${x.nombre}`), s.monto, { countLabel: 'Pedidos' }); r = mesas.next;
  const zonas = tableSection(ws, r, 'Zonas de delivery (top 10)', asCount(data.zonas, 'pedidos'), s.monto, { countLabel: 'Pedidos' }); r = zonas.next;
  const dias = dailySection(ws, r, 'Evolución diaria', data.dias.map(d => ({ ...d, cantidad: d.pedidos })), 'Pedidos');
  ws.getCell(`A${r - 1}`).value = 'Los rankings usan importes de líneas y pueden diferir del total por descuentos, recargos y delivery.';
  ws.getCell(`A${r - 1}`).font = { color: { argb: 'FF5B6B65' }, size: 9, italic: true };

  const wp = wb.addWorksheet('Pedidos', { views: [{ state: 'frozen', ySplit: 4 }] });
  wp.columns = [{ width: 8 }, { width: 12 }, { width: 7 }, { width: 12 }, { width: 8 }, { width: 30 }, { width: 18 }, { width: 12 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 16 }, { width: 14 }, { width: 30 }];
  wp.getCell('A1').value = 'Detalle de pedidos';
  wp.getCell('A1').font = { bold: true, size: 14 };
  wp.getCell('A2').value = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)} · por fecha de confirmación · Los anulados no suman al total`;
  const head = wp.getRow(4);
  head.values = ['#', 'Fecha', 'Hora', 'Entrega', 'Mesa', 'Cliente', 'Zona', 'Estado', 'Descuento', 'Recargo', 'Delivery', 'Total', 'Confirmado por', 'Motivo de anulación'];
  styleHeaderRow(head);
  data.lista.forEach((p, i) => {
    const row = wp.getRow(5 + i);
    row.values = [p.idpedido, toDate(p.fecha), p.hora, entregaLabel(p.tipo_entrega), p.mesa || '', p.cliente || '', p.zona || '', estadoTexto(p.estado), p.descuento, p.recargo, p.delivery, p.monto, p.confirmado_por || '', p.motivo_anulado || ''];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    [9, 10, 11, 12].forEach(n => { row.getCell(n).numFmt = MONEY; });
    if (p.estado === 'cancelado') row.font = { color: { argb: 'FF8A9590' }, strike: true };
  });
  const last = 4 + data.lista.length;
  const has = data.lista.length > 0;
  [
    ['TOTAL VENTAS CONFIRMADAS', has ? { formula: `SUM(L5:L${last})-SUMIFS(L5:L${last},H5:H${last},"Anulado")`, result: s.monto } : 0, true],
    ['Anulados (no suman)', has ? { formula: `SUMIFS(L5:L${last},H5:H${last},"Anulado")`, result: s.anulados.monto } : 0, false]
  ].forEach(([label, value, bold], i) => {
    const row = wp.getRow(last + 2 + i);
    row.getCell(11).value = label;
    row.getCell(12).value = value;
    row.getCell(12).numFmt = MONEY;
    row.font = { bold, color: bold ? undefined : { argb: 'FF5B6B65' } };
    row.getCell(11).alignment = { horizontal: 'right' };
  });
  if (has) wp.autoFilter = `A4:N${last}`;
  wp.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const chart = chartBuilders(RESUMEN);
  const charts = [];
  if (dias.count) charts.push({ xml: chart.daily('Evolución diaria (pedidos e importe)', dias, 'Pedidos'), rows: 20 });
  if (entregas.count) charts.push({ xml: chart.doughnut('Tipos de entrega (importe)', entregas) });
  if (pagos.count) charts.push({ xml: chart.doughnut('Cobros por forma de pago', pagos) });
  if (productos.count) charts.push({ xml: chart.hbar('Productos más vendidos (importe)', productos, 3001), rows: 22 });
  if (categorias.count) charts.push({ xml: chart.hbar('Categorías más vendidas (importe)', categorias, 5001), rows: 20 });
  if (semana.count) charts.push({ xml: chart.hbar('Días de la semana (importe)', semana, 4001) });
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), RESUMEN, charts);
}
