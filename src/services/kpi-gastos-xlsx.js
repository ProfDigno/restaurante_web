import ExcelJS from 'exceljs';
import { change, isoToText } from './report-pdf.js';
import { MONEY, toDate, styleHeaderRow, title, indicators, tableSection, dailySection, chartBuilders, addCharts } from './report-xlsx.js';

// Excel del Análisis de gastos: hoja "Resumen" (indicadores, tablas y gráficos nativos) y hoja "Gastos" (detalle con totales).
const RESUMEN = 'Resumen';

export async function renderKpiGastosXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  wb.created = new Date();

  const ws = wb.addWorksheet(RESUMEN, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 12 }, { width: 18 }, { width: 30 }, { width: 3 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  title(ws, 'Análisis de gastos', `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)}`, restaurante);
  let r = indicators(ws, [
    ['Gasto total', s.monto, MONEY, `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Gastos pagados', s.cantidad, '#,##0', `${change(s.cantidad, s.anterior.cantidad)} vs. período anterior`],
    ['Gasto promedio', Math.round(s.promedio), MONEY, 'Total / gastos pagados'],
    ['Anulados (cantidad)', s.anulados.cantidad, '#,##0', 'Separado del total'],
    ['Anulados (importe)', s.anulados.monto, MONEY, 'Separado del total'],
    ['Período anterior (importe)', s.anterior.monto, MONEY, 'Mismo número de días, inmediatamente antes']
  ]);
  const tipos = tableSection(ws, r, 'Tipos de gasto', data.tipos, s.monto); r = tipos.next;
  const formas = tableSection(ws, r, 'Formas de pago', data.formas, s.monto); r = formas.next;
  const semana = tableSection(ws, r, 'Días de la semana', data.semana, s.monto); r = semana.next;
  const dias = dailySection(ws, r, 'Evolución diaria', data.dias, 'Gastos');

  const wg = wb.addWorksheet('Gastos', { views: [{ state: 'frozen', ySplit: 4 }] });
  wg.columns = [{ width: 8 }, { width: 12 }, { width: 22 }, { width: 46 }, { width: 18 }, { width: 11 }, { width: 16 }, { width: 16 }, { width: 30 }];
  wg.getCell('A1').value = 'Detalle de gastos';
  wg.getCell('A1').font = { bold: true, size: 14 };
  wg.getCell('A2').value = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)} · Los anulados no suman al total`;
  const gh = wg.getRow(4);
  gh.values = ['#', 'Fecha', 'Tipo', 'Descripción', 'Forma de pago', 'Estado', 'Importe', 'Registrado por', 'Motivo de anulación'];
  styleHeaderRow(gh);
  data.gastos.forEach((g, i) => {
    const row = wg.getRow(5 + i);
    const anulado = g.estado === 'anulado';
    row.values = [g.idgasto, toDate(g.fecha), g.tipo, g.descripcion, g.forma_pago, anulado ? 'Anulado' : 'Pagado', g.monto, g.creado_por, g.motivo_anulado || ''];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    row.getCell(7).numFmt = MONEY;
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    if (anulado) row.font = { color: { argb: 'FF8A9590' }, strike: true };
  });
  const gLast = 4 + data.gastos.length;
  const range = data.gastos.length ? `G5:G${gLast}` : null;
  [['TOTAL GASTOS PAGADOS', 'Pagado', s.monto, true], ['Anulados (no suman)', 'Anulado', s.anulados.monto, false]].forEach(([label, estado, result, bold], i) => {
    const row = wg.getRow(gLast + 2 + i);
    row.getCell(6).value = label;
    row.getCell(7).value = range ? { formula: `SUMIFS(${range},F5:F${gLast},"${estado}")`, result } : 0;
    row.getCell(7).numFmt = MONEY;
    row.font = { bold, color: bold ? undefined : { argb: 'FF5B6B65' } };
    row.getCell(6).alignment = { horizontal: 'right' };
  });
  if (data.gastos.length) wg.autoFilter = `A4:I${gLast}`;
  wg.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const chart = chartBuilders(RESUMEN);
  const charts = [];
  if (dias.count) charts.push({ xml: chart.daily('Evolución diaria (cantidad e importe)', dias, 'Gastos'), rows: 20 });
  if (tipos.count) charts.push({ xml: chart.doughnut('Tipos de gasto (importe)', tipos) });
  if (formas.count) charts.push({ xml: chart.doughnut('Formas de pago (importe)', formas) });
  if (semana.count) charts.push({ xml: chart.hbar('Días de la semana (importe)', semana) });
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), RESUMEN, charts);
}
