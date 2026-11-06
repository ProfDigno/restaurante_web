import ExcelJS from 'exceljs';
import { change, isoToText } from './report-pdf.js';
import { MONEY, toDate, styleHeaderRow, title, indicators, tableSection, dailySection, chartBuilders, addCharts } from './report-xlsx.js';

// Excel del Análisis de compras: hoja "Resumen" (indicadores, tablas y gráficos nativos) y hoja "Compras" (detalle con totales).
const RESUMEN = 'Resumen';
const estadoTexto = c => c.estado === 'cancelada' ? 'Cancelada' : c.estado === 'borrador' ? 'Borrador' : c.saldo > 0 ? 'Pendiente' : 'Pagada';

export async function renderKpiComprasXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  wb.created = new Date();

  const ws = wb.addWorksheet(RESUMEN, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 38 }, { width: 12 }, { width: 18 }, { width: 34 }, { width: 3 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  title(ws, 'Análisis de compras', `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)}`, restaurante);
  let r = indicators(ws, [
    ['Total comprado', s.monto, MONEY, `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Compras recibidas', s.cantidad, '#,##0', `${change(s.cantidad, s.anterior.cantidad)} vs. período anterior`],
    ['Compra promedio', Math.round(s.promedio), MONEY, 'Total / compras recibidas'],
    ['Pagado', s.pagado, MONEY, 'Pagos aprobados de las compras recibidas'],
    ['Saldo pendiente', s.saldo, MONEY, `${s.pendientes} compras con saldo`],
    ['Canceladas', s.canceladas.monto, MONEY, `${s.canceladas.cantidad} compras · separado del total`],
    ['Borradores (estimado)', s.borradores.monto, MONEY, `${s.borradores.cantidad} compras sin recibir`],
    ['Período anterior (importe)', s.anterior.monto, MONEY, 'Mismo número de días, inmediatamente antes']
  ]);
  const proveedores = tableSection(ws, r, 'Proveedores', data.proveedores, s.monto, { countLabel: 'Compras' }); r = proveedores.next;
  const condiciones = tableSection(ws, r, 'Contado y crédito', data.condiciones, s.monto, { countLabel: 'Compras' }); r = condiciones.next;
  const formas = tableSection(ws, r, 'Formas de pago (pagos registrados)', data.formas, s.pagado, { countLabel: 'Pagos' }); r = formas.next;
  const productos = tableSection(ws, r, 'Productos más comprados', data.productos.map(p => ({ ...p, cantidad: p.unidades })), s.monto, { countLabel: 'Unidades' }); r = productos.next;
  const semana = tableSection(ws, r, 'Días de la semana', data.semana, s.monto, { countLabel: 'Compras' }); r = semana.next;
  const dias = dailySection(ws, r, 'Evolución diaria', data.dias, 'Compras');

  const wc = wb.addWorksheet('Compras', { views: [{ state: 'frozen', ySplit: 4 }] });
  wc.columns = [{ width: 8 }, { width: 12 }, { width: 32 }, { width: 18 }, { width: 11 }, { width: 12 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 30 }];
  wc.getCell('A1').value = 'Detalle de compras';
  wc.getCell('A1').font = { bold: true, size: 14 };
  wc.getCell('A2').value = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)} · Solo las recibidas (Pagada o Pendiente) suman al total`;
  const head = wc.getRow(4);
  head.values = ['#', 'Fecha', 'Proveedor', 'Nota / factura', 'Condición', 'Estado', 'Productos', 'Total', 'Pagado', 'Saldo', 'Registrado por', 'Motivo de cancelación'];
  styleHeaderRow(head);
  data.compras.forEach((c, i) => {
    const row = wc.getRow(5 + i);
    row.values = [c.idcompra, toDate(c.fecha), c.proveedor, c.numero_nota || '', c.condicion, estadoTexto(c), c.productos, c.monto, c.pagado, c.saldo, c.creado_por, c.motivo_anulado || ''];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    [8, 9, 10].forEach(n => { row.getCell(n).numFmt = MONEY; });
    if (c.estado !== 'recibida') row.font = { color: { argb: 'FF8A9590' }, italic: true };
  });
  const last = 4 + data.compras.length;
  const has = data.compras.length > 0;
  const sumIfs = (col, result) => has ? { formula: `SUMIFS(${col}5:${col}${last},F5:F${last},"Pagada")+SUMIFS(${col}5:${col}${last},F5:F${last},"Pendiente")`, result } : 0;
  const sumEstado = (estado, result) => has ? { formula: `SUMIFS(H5:H${last},F5:F${last},"${estado}")`, result } : 0;
  [
    ['TOTAL COMPRAS RECIBIDAS', sumIfs('H', s.monto), true],
    ['Pagado', sumIfs('I', s.pagado), false],
    ['Saldo pendiente', sumIfs('J', s.saldo), false],
    ['Canceladas (no suman)', sumEstado('Cancelada', s.canceladas.monto), false],
    ['Borradores (no suman)', sumEstado('Borrador', s.borradores.monto), false]
  ].forEach(([label, value, bold], i) => {
    const row = wc.getRow(last + 2 + i);
    row.getCell(7).value = label;
    row.getCell(8).value = value;
    row.getCell(8).numFmt = MONEY;
    row.font = { bold, color: bold ? undefined : { argb: 'FF5B6B65' } };
    row.getCell(7).alignment = { horizontal: 'right' };
  });
  if (has) wc.autoFilter = `A4:L${last}`;
  wc.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const chart = chartBuilders(RESUMEN);
  const charts = [];
  if (dias.count) charts.push({ xml: chart.daily('Evolución diaria (cantidad e importe)', dias, 'Compras'), rows: 20 });
  if (proveedores.count) charts.push({ xml: chart.hbar('Proveedores (importe)', proveedores, 2001) });
  if (condiciones.count) charts.push({ xml: chart.doughnut('Contado y crédito (importe)', condiciones) });
  if (formas.count) charts.push({ xml: chart.doughnut('Formas de pago (pagos)', formas) });
  if (productos.count) charts.push({ xml: chart.hbar('Productos más comprados (importe)', productos, 3001), rows: 20 });
  if (semana.count) charts.push({ xml: chart.hbar('Días de la semana (importe)', semana, 4001) });
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), RESUMEN, charts);
}
