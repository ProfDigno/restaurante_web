import JSZip from 'jszip';
import { isoToText } from './report-pdf.js';

// Utilidades de Excel para los análisis: formato, tablas y gráficos nativos (DrawingML).
// ExcelJS no genera gráficos, así que se agregan al .xlsx ya escrito con addCharts().
export const MONEY = '"Gs." #,##0';
const colors = ['D07A55', '4F83C4', '66AA8B', 'AB84BE', 'D9A440', '639BA8', 'DC7891'];
const headerStyle = { font: { bold: true, color: { argb: 'FF17201F' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9EFEC' } } };
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export const toDate = iso => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
export const noteFont = { color: { argb: 'FF5B6B65' }, size: 9 };

export function styleHeaderRow(row) { row.eachCell(cell => { cell.font = headerStyle.font; cell.fill = headerStyle.fill; cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8C4BE' } } }; }); }

export function title(ws, text, subtitle, restaurante) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { bold: true, size: 16 };
  ws.getCell('A2').value = subtitle;
  const nombre = restaurante?.nombre_fantasia || restaurante?.razon_social;
  ws.getCell('A3').value = `${nombre ? `${nombre} · ` : ''}Generado: ${new Date().toLocaleString('es-PY')}`;
  ws.getCell('A3').font = noteFont;
}

// Indicadores desde la fila 5: [[etiqueta, valor, formato, nota]]. Devuelve la siguiente fila libre.
export function indicators(ws, list, start = 5) {
  ws.getCell(`A${start}`).value = 'Indicadores';
  ws.getCell(`A${start}`).font = { bold: true, size: 12 };
  list.forEach(([label, value, fmt, note], i) => {
    const row = ws.getRow(start + 1 + i);
    row.getCell(1).value = label;
    row.getCell(3).value = value;
    row.getCell(3).numFmt = fmt;
    row.getCell(3).font = { bold: true };
    row.getCell(4).value = note;
    row.getCell(4).font = noteFont;
  });
  return start + list.length + 3;
}

// Tabla Concepto/Cantidad/Importe/% (columnas A-D). Devuelve las filas de datos para los gráficos.
export function tableSection(ws, startRow, heading, rows, total, { countLabel = 'Cantidad' } = {}) {
  ws.getCell(`A${startRow}`).value = heading;
  ws.getCell(`A${startRow}`).font = { bold: true, size: 12 };
  const headRow = ws.getRow(startRow + 1);
  headRow.values = ['Concepto', countLabel, 'Importe', '% del total'];
  styleHeaderRow(headRow);
  const first = startRow + 2;
  rows.forEach((r, i) => {
    const row = ws.getRow(first + i);
    row.values = [r.nombre, r.cantidad, r.monto, total ? r.monto / total : 0];
    row.getCell(3).numFmt = MONEY;
    row.getCell(4).numFmt = '0.0%';
  });
  const last = first + rows.length - 1;
  const totalRow = ws.getRow(last + 1);
  totalRow.getCell(1).value = 'Total';
  totalRow.getCell(2).value = rows.length ? { formula: `SUM(B${first}:B${last})`, result: rows.reduce((a, r) => a + r.cantidad, 0) } : 0;
  totalRow.getCell(3).value = rows.length ? { formula: `SUM(C${first}:C${last})`, result: rows.reduce((a, r) => a + r.monto, 0) } : 0;
  totalRow.getCell(3).numFmt = MONEY;
  totalRow.font = { bold: true };
  return { first, last, next: last + 3, count: rows.length, rows };
}

// Tabla diaria Fecha/Cantidad/Importe (columnas A-C).
export function dailySection(ws, startRow, heading, dias, countLabel) {
  ws.getCell(`A${startRow}`).value = heading;
  ws.getCell(`A${startRow}`).font = { bold: true, size: 12 };
  const head = ws.getRow(startRow + 1);
  head.values = ['Fecha', countLabel, 'Importe'];
  styleHeaderRow(head);
  const first = startRow + 2;
  dias.forEach((d, i) => {
    const row = ws.getRow(first + i);
    row.values = [isoToText(d.fecha), d.cantidad, d.monto];
    row.getCell(3).numFmt = MONEY;
  });
  return { first, last: first + dias.length - 1, next: first + dias.length + 2, count: dias.length, rows: dias };
}

// ---------- Gráficos nativos
const strCache = values => `<c:strCache><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = values => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values.map((v, i) => `<c:pt idx="${i}"><c:v>${Number(v) || 0}</c:v></c:pt>`).join('')}</c:numCache>`;
const fill = color => `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr>`;
const lineSp = color => `<c:spPr><a:ln w="31750" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr>`;
const chartTitle = text => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200" b="1"/></a:pPr><a:r><a:rPr lang="es-ES" sz="1200" b="1"/><a:t>${xml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
const serTx = text => `<c:tx><c:v>${xml(text)}</c:v></c:tx>`;
const small = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr>';
const catAx = (id, cross, pos, { hidden = false, reverse = false } = {}) => `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="${reverse ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="${hidden ? 1 : 0}"/><c:axPos val="${pos}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${small}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
const valAx = (id, cross, pos, fmt, { grid = true, crosses = 'autoZero', majorUnit = null } = {}) => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E8E6"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>' : ''}<c:numFmt formatCode="${xml(fmt)}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>${small}<c:crossAx val="${cross}"/><c:crosses val="${crosses}"/><c:crossBetween val="between"/>${majorUnit ? `<c:majorUnit val="${majorUnit}"/>` : ''}</c:valAx>`;
const legend = pos => `<c:legend><c:legendPos val="${pos}"/><c:overlay val="0"/></c:legend>`;
const chartSpace = (titleText, plotArea, legendXml = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${chartTitle(titleText)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plotArea}</c:plotArea>${legendXml}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="DFE5E2"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;

export function chartBuilders(sheetName) {
  const ref = (col, s) => `'${sheetName}'!$${col}$${s.first}:$${col}$${s.last}`;
  const cat = (col, s, labels) => `<c:cat><c:strRef><c:f>${ref(col, s)}</c:f>${strCache(labels)}</c:strRef></c:cat>`;
  const val = (col, s, values) => `<c:val><c:numRef><c:f>${ref(col, s)}</c:f>${numCache(values)}</c:numRef></c:val>`;
  return {
    // Columnas de cantidad (eje izquierdo) + línea de importe (eje derecho).
    daily(titleText, s, countLabel) {
      const labels = s.rows.map(d => isoToText(d.fecha).slice(0, 5));
      const maxCount = Math.max(...s.rows.map(d => d.cantidad), 0);
      const bar = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${serTx(countLabel)}${fill(colors[0])}<c:invertIfNegative val="0"/>${cat('A', s, labels)}${val('B', s, s.rows.map(d => d.cantidad))}</c:ser><c:gapWidth val="60"/><c:axId val="1001"/><c:axId val="1002"/></c:barChart>`;
      const line = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/><c:ser><c:idx val="1"/><c:order val="1"/>${serTx('Importe')}${lineSp(colors[1])}<c:marker><c:symbol val="none"/></c:marker>${cat('A', s, labels)}${val('C', s, s.rows.map(d => d.monto))}<c:smooth val="0"/></c:ser><c:marker val="1"/><c:axId val="1003"/><c:axId val="1004"/></c:lineChart>`;
      const axes = catAx(1001, 1002, 'b') + valAx(1002, 1001, 'l', '#,##0', { majorUnit: maxCount <= 10 ? 1 : null }) + catAx(1003, 1004, 'b', { hidden: true }) + valAx(1004, 1003, 'r', '#,##0', { grid: false, crosses: 'max' });
      return chartSpace(titleText, bar + line + axes, legend('b'));
    },
    doughnut(titleText, s) {
      const points = s.rows.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${fill(colors[i % colors.length])}</c:dPt>`).join('');
      const labels = '<c:dLbls><c:numFmt formatCode="0.0%" sourceLinked="0"/><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="es-ES"/></a:p></c:txPr><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="1"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>';
      const plot = `<c:doughnutChart><c:varyColors val="1"/><c:ser><c:idx val="0"/><c:order val="0"/>${serTx('Importe')}${points}${labels}${cat('A', s, s.rows.map(r => r.nombre))}${val('C', s, s.rows.map(r => r.monto))}</c:ser><c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
      return chartSpace(titleText, plot, legend('r'));
    },
    // Barras horizontales de importe (primer elemento arriba).
    hbar(titleText, s, axisBase = 2001) {
      const plot = `<c:barChart><c:barDir val="bar"/><c:grouping val="clustered"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/>${serTx('Importe')}${fill(colors[0])}<c:invertIfNegative val="0"/>${cat('A', s, s.rows.map(r => r.nombre))}${val('C', s, s.rows.map(r => r.monto))}</c:ser><c:gapWidth val="50"/><c:axId val="${axisBase}"/><c:axId val="${axisBase + 1}"/></c:barChart>${catAx(axisBase, axisBase + 1, 'l', { reverse: true })}${valAx(axisBase + 1, axisBase, 'b', '#,##0')}`;
      return chartSpace(titleText, plot);
    }
  };
}

const anchor = (index, fromRow, toRow) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>14</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 1}" name="Gráfico ${index}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

// Apila los gráficos (columnas F a N) en la hoja indicada. charts: [{xml, rows}].
export async function addCharts(buffer, sheetName, list) {
  const charts = [];
  let row = 0;
  for (const c of list) { charts.push({ xml: c.xml, from: row, to: row + (c.rows || 18) }); row += (c.rows || 18) + 1; }
  if (!charts.length) return buffer;
  const zip = await JSZip.loadAsync(buffer);
  const workbook = await zip.file('xl/workbook.xml').async('string');
  const rid = workbook.match(new RegExp(`<sheet[^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`))?.[1];
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const target = wbRels.match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
    || wbRels.match(new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  if (!target) throw new Error(`No se encontró la hoja ${sheetName} en el Excel generado`);
  const sheetPath = `xl/${target.replace(/^\/?xl\//, '')}`;
  const relsPath = `xl/worksheets/_rels/${sheetPath.split('/').pop()}.rels`;

  charts.forEach((chart, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chart.xml));
  zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${charts.map((c, i) => anchor(i + 1, c.from, c.to)).join('')}</xdr:wsDr>`);
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}</Relationships>`);

  const drawingRel = '<Relationship Id="rIdDrawing1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
  const existingRels = zip.file(relsPath) ? await zip.file(relsPath).async('string') : null;
  zip.file(relsPath, existingRels ? existingRels.replace('</Relationships>', `${drawingRel}</Relationships>`)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRel}</Relationships>`);

  let sheet = await zip.file(sheetPath).async('string');
  if (!/xmlns:r=/.test(sheet.slice(0, 600))) sheet = sheet.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  // <drawing> va antes de legacyDrawing/tableParts/extLst y después de pageMargins/pageSetup/headerFooter.
  const before = sheet.search(/<(legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)[\s>]/);
  const tag = '<drawing r:id="rIdDrawing1"/>';
  sheet = before >= 0 ? sheet.slice(0, before) + tag + sheet.slice(before) : sheet.replace('</worksheet>', `${tag}</worksheet>`);
  zip.file(sheetPath, sheet);

  let types = await zip.file('[Content_Types].xml').async('string');
  types = types.replace('</Types>', ['<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>',
    ...charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`)].join('') + '</Types>');
  zip.file('[Content_Types].xml', types);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
