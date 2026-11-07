import ExcelJS from 'exceljs';
import { change, isoToText } from './report-pdf.js';
import { MONEY, toDate, styleHeaderRow, title, indicators, tableSection, dailySection, chartBuilders, addCharts, noteFont } from './report-xlsx.js';

// Excel del Análisis de vales: hoja "Resumen" (indicadores, tablas y gráficos nativos),
// hoja "Personas" (resumen por persona con % del sueldo) y hoja "Vales" (detalle con totales).
const RESUMEN = 'Resumen';
const PCT = '0.0%';
const pagoLabel = { DIARIO: 'Diario', SEMANAL: 'Semanal', QUINCENAL: 'Quincenal', MENSUAL: 'Mensual' };

export async function renderKpiValesXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  wb.created = new Date();
  const subtitle = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)}${data.filtro ? ` · ${data.filtro}` : ''}`;

  const ws = wb.addWorksheet(RESUMEN, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 34 }, { width: 12 }, { width: 18 }, { width: 34 }, { width: 3 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  title(ws, 'Análisis de vales', subtitle, restaurante);
  let r = indicators(ws, [
    ['Total en vales', s.monto, MONEY, `${change(s.monto, s.anterior.monto)} vs. período anterior`],
    ['Vales pagados', s.cantidad, '#,##0', `${change(s.cantidad, s.anterior.cantidad)} vs. período anterior`],
    ['Personas con vales', s.personas, '#,##0', 'Personas distintas con al menos un vale pagado'],
    ['Vale promedio', Math.round(s.promedio), MONEY, 'Total / vales pagados'],
    ['Parte del sueldo del período', s.pct_sueldo === null ? 'Sin sueldos cargados' : s.pct_sueldo / 100, PCT, s.pct_sueldo === null ? '' : `Sobre ${s.sueldo_periodo.toLocaleString('es-PY')} Gs. (aprox., ${data.dias_periodo} días)`],
    ['Anulados (cantidad)', s.anulados.cantidad, '#,##0', 'Separado del total'],
    ['Anulados (importe)', s.anulados.monto, MONEY, 'Separado del total']
  ]);
  const personas = tableSection(ws, r, 'Vales por persona', data.personas, s.monto, { countLabel: 'Vales' }); r = personas.next;
  const cargos = tableSection(ws, r, 'Vales por cargo', data.cargos, s.monto, { countLabel: 'Vales' }); r = cargos.next;
  const formas = tableSection(ws, r, 'Formas de pago', data.formas, s.monto, { countLabel: 'Vales' }); r = formas.next;
  const semana = tableSection(ws, r, 'Días de la semana', data.semana, s.monto, { countLabel: 'Vales' }); r = semana.next;
  const dias = dailySection(ws, r, 'Evolución diaria', data.dias, 'Vales');

  const wp = wb.addWorksheet('Personas', { views: [{ state: 'frozen', ySplit: 4 }] });
  wp.columns = [{ width: 30 }, { width: 18 }, { width: 8 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 11 }, { width: 12 }];
  wp.getCell('A1').value = 'Vales por persona';
  wp.getCell('A1').font = { bold: true, size: 14 };
  wp.getCell('A2').value = `${subtitle} · "Sueldo del período": sueldo según su tipo de pago por ${data.dias_periodo} días corridos (aproximado)`;
  wp.getCell('A2').font = noteFont;
  const ph = wp.getRow(4);
  ph.values = ['Persona', 'Cargo', 'Vales', 'Total', 'Promedio', 'Mayor vale', 'Tipo de pago', 'Sueldo', 'Sueldo del período', '% sueldo', 'Último vale'];
  styleHeaderRow(ph);
  data.personas.forEach((p, i) => {
    const n = 5 + i, row = wp.getRow(n);
    row.values = [p.nombre, p.cargo || '', p.cantidad, p.monto, { formula: `IF(C${n}=0,0,D${n}/C${n})`, result: p.promedio }, p.mayor,
      pagoLabel[p.tipo_pago] || p.tipo_pago, p.monto_pago, p.sueldo_periodo || null,
      p.sueldo_periodo ? { formula: `D${n}/I${n}`, result: p.pct_sueldo / 100 } : null, p.ultimo ? toDate(p.ultimo) : null];
    [4, 5, 6, 8, 9].forEach(c => { row.getCell(c).numFmt = MONEY; });
    row.getCell(10).numFmt = PCT;
    row.getCell(11).numFmt = 'dd/mm/yyyy';
  });
  if (data.personas.length) wp.autoFilter = `A4:K${4 + data.personas.length}`;

  const wv = wb.addWorksheet('Vales', { views: [{ state: 'frozen', ySplit: 4 }] });
  wv.columns = [{ width: 8 }, { width: 12 }, { width: 28 }, { width: 18 }, { width: 40 }, { width: 18 }, { width: 11 }, { width: 16 }, { width: 16 }, { width: 30 }];
  wv.getCell('A1').value = 'Detalle de vales';
  wv.getCell('A1').font = { bold: true, size: 14 };
  wv.getCell('A2').value = `${subtitle} · Los anulados no suman al total`;
  const vh = wv.getRow(4);
  vh.values = ['#', 'Fecha', 'Persona', 'Cargo', 'Concepto', 'Forma de pago', 'Estado', 'Importe', 'Registrado por', 'Motivo de anulación'];
  styleHeaderRow(vh);
  data.vales.forEach((v, i) => {
    const row = wv.getRow(5 + i);
    const anulado = v.estado === 'anulado';
    row.values = [v.idvale, toDate(v.fecha), v.personal, v.cargo || '', v.descripcion, v.forma_pago, anulado ? 'Anulado' : 'Pagado', v.monto, v.creado_por, v.motivo_anulado || ''];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    row.getCell(8).numFmt = MONEY;
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    if (anulado) row.font = { color: { argb: 'FF8A9590' }, strike: true };
  });
  const last = 4 + data.vales.length;
  const range = data.vales.length ? `H5:H${last}` : null;
  [['TOTAL VALES PAGADOS', 'Pagado', s.monto, true], ['Anulados (no suman)', 'Anulado', s.anulados.monto, false]].forEach(([label, estado, result, bold], i) => {
    const row = wv.getRow(last + 2 + i);
    row.getCell(7).value = label;
    row.getCell(8).value = range ? { formula: `SUMIFS(${range},G5:G${last},"${estado}")`, result } : 0;
    row.getCell(8).numFmt = MONEY;
    row.font = { bold, color: bold ? undefined : { argb: 'FF5B6B65' } };
    row.getCell(7).alignment = { horizontal: 'right' };
  });
  if (data.vales.length) wv.autoFilter = `A4:J${last}`;
  wv.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const chart = chartBuilders(RESUMEN);
  const charts = [];
  if (dias.count) charts.push({ xml: chart.daily('Evolución diaria (cantidad e importe)', dias, 'Vales'), rows: 20 });
  if (personas.count) charts.push({ xml: chart.hbar('Vales por persona (importe)', personas, 2001) });
  if (cargos.count) charts.push({ xml: chart.doughnut('Vales por cargo (importe)', cargos) });
  if (formas.count) charts.push({ xml: chart.doughnut('Formas de pago (importe)', formas) });
  if (semana.count) charts.push({ xml: chart.hbar('Días de la semana (importe)', semana, 2101) });
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), RESUMEN, charts);
}
