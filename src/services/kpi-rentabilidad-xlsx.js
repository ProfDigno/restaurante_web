import ExcelJS from 'exceljs';
import { change, isoToText } from './report-pdf.js';
import { MONEY, styleHeaderRow, title, indicators, tableSection, chartBuilders, addCharts, noteFont } from './report-xlsx.js';

// Excel del Análisis de rentabilidad: hoja "Resumen" (indicadores, margen por categoría y top 10 con gráficos)
// y hoja "Productos" (detalle con fórmulas de margen, filtros y totales).
const RESUMEN = 'Resumen';
const PCT = '0.0%';

export async function renderKpiRentabilidadXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  wb.created = new Date();
  const subtitle = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)}${data.filtro ? ` · ${data.filtro}` : ''}`;

  const ws = wb.addWorksheet(RESUMEN, { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 38 }, { width: 12 }, { width: 18 }, { width: 34 }, { width: 3 }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  title(ws, 'Análisis de rentabilidad', subtitle, restaurante);
  const list = [
    ['Venta de productos', s.venta, MONEY, `${change(s.venta, s.anterior.venta)} vs. período anterior`],
    ['Costo', s.costo, MONEY, 'Costo guardado al vender cada producto'],
    ['Margen bruto', s.margen, MONEY, `${change(s.margen, s.anterior.margen)} vs. período anterior`],
    ['Margen bruto %', s.margen_pct / 100, PCT, `Período anterior: ${s.anterior.margen_pct.toFixed(1)}%`]
  ];
  if (s.margen_neto !== null) list.push(['Descuentos de pedidos', s.descuentos, MONEY, 'Se restan del total, no por producto'], ['Margen neto', s.margen_neto, MONEY, 'Margen bruto − descuentos']);
  list.push(['Pedidos', s.pedidos, '#,##0', `${s.unidades.toLocaleString('es-PY')} unidades vendidas`]);
  if (s.productos_con_perdida) list.push(['Productos vendidos con pérdida', s.productos_con_perdida, '#,##0', `Pérdida total ${Math.abs(s.perdida).toLocaleString('es-PY')} Gs.: el costo supera la venta`]);
  if (s.productos_costo_sospechoso) list.push(['Productos con costo sospechoso', s.productos_costo_sospechoso, '#,##0', 'Costo menor al 1% de la venta (p. ej. precio de compra 1 Gs.)']);
  if (s.productos_sin_costo) list.push(['Productos con ventas sin costo', s.productos_sin_costo, '#,##0', `Venta ${s.venta_sin_costo.toLocaleString('es-PY')} Gs. con costo 0: cuenta como 100% de margen`]);
  let r = indicators(ws, list);
  const asRows = rows => rows.filter(x => x.venta > 0 || x.margen !== 0).map(x => ({ nombre: x.etiqueta || x.nombre, cantidad: x.unidades, monto: x.margen }));
  const categorias = tableSection(ws, r, 'Margen por categoría', asRows(data.categorias), s.margen, { countLabel: 'Unidades' }); r = categorias.next;
  const top = tableSection(ws, r, 'Diez productos con mayor margen', asRows(data.productos.slice(0, 10)), s.margen, { countLabel: 'Unidades' });
  ws.getCell(`A${top.next}`).value = 'Las columnas "Importe" muestran el margen bruto; "% del total" es su parte del margen total.';
  ws.getCell(`A${top.next}`).font = noteFont;

  const wp = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 4 }] });
  wp.columns = [{ width: 36 }, { width: 22 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 10 }, { width: 12 }];
  wp.getCell('A1').value = 'Rentabilidad por producto';
  wp.getCell('A1').font = { bold: true, size: 14 };
  wp.getCell('A2').value = `${subtitle} · "Sin costo": ninguna venta con costo · "Costo incompleto": algunas ventas sin costo · "Costo sospechoso": menos del 1% de la venta · "Estimado": costo con el precio actual del ingrediente`;
  wp.getCell('A2').font = noteFont;
  const head = wp.getRow(4);
  head.values = ['Producto', 'Categoría', 'Unidad', 'Unidades', 'Venta', 'Costo', 'Margen', 'Margen %', 'Nota'];
  styleHeaderRow(head);
  data.productos.forEach((p, i) => {
    const n = 5 + i, row = wp.getRow(n);
    row.values = [p.nombre, p.categoria, p.unidad, p.unidades, p.venta, p.costo,
      { formula: `E${n}-F${n}`, result: p.margen }, { formula: `IF(E${n}=0,0,G${n}/E${n})`, result: p.margen_pct / 100 },
      p.sin_costo ? 'Sin costo' : p.costo_incompleto ? 'Costo incompleto' : p.costo_sospechoso ? 'Costo sospechoso' : p.estimado ? 'Estimado' : ''];
    [5, 6, 7].forEach(c => { row.getCell(c).numFmt = MONEY; });
    row.getCell(8).numFmt = PCT;
    if (p.sin_costo) row.font = { color: { argb: 'FF8A9590' } };
  });
  const last = 4 + data.productos.length;
  if (data.productos.length) {
    const total = wp.getRow(last + 2);
    total.getCell(1).value = 'TOTAL';
    total.getCell(4).value = { formula: `SUM(D5:D${last})`, result: s.unidades };
    total.getCell(5).value = { formula: `SUM(E5:E${last})`, result: s.venta };
    total.getCell(6).value = { formula: `SUM(F5:F${last})`, result: s.costo };
    total.getCell(7).value = { formula: `E${last + 2}-F${last + 2}`, result: s.margen };
    total.getCell(8).value = { formula: `IF(E${last + 2}=0,0,G${last + 2}/E${last + 2})`, result: s.margen_pct / 100 };
    [5, 6, 7].forEach(c => { total.getCell(c).numFmt = MONEY; });
    total.getCell(8).numFmt = PCT;
    total.font = { bold: true };
    wp.autoFilter = `A4:I${last}`;
  }
  wp.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const chart = chartBuilders(RESUMEN);
  const charts = [];
  if (categorias.count) charts.push({ xml: chart.hbar('Margen por categoría', categorias, 2001) });
  if (top.count) charts.push({ xml: chart.hbar('Productos con mayor margen', top, 2101) });
  return addCharts(Buffer.from(await wb.xlsx.writeBuffer()), RESUMEN, charts);
}
