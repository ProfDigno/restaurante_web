import ExcelJS from 'exceljs';
import { isoToText } from './report-pdf.js';
import { MONEY, toDate, styleHeaderRow, title, indicators, noteFont } from './report-xlsx.js';

// Excel de Pagos a delivery: hoja "Resumen" (indicadores y pendiente por entregador), "Pedidos" y "Pagos".
export async function renderPagosDeliveryXlsx(data, restaurante) {
  const s = data.resumen;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Restaurante Web';
  const subtitle = `Período: ${isoToText(data.inicio)} al ${isoToText(data.fin)}${data.filtro ? ` · ${data.filtro}` : ''}`;

  const ws = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 32 }, { width: 12 }, { width: 18 }, { width: 18 }, { width: 18 }];
  title(ws, 'Pagos a delivery', subtitle, restaurante);
  let r = indicators(ws, [
    ['Delivery del período', s.total, MONEY, `${s.pedidos} pedidos con entregador`],
    ['Ya pagado', s.pagado, MONEY, 'Pagado a los entregadores'],
    ['Pendiente de pagar', s.pendiente, MONEY, 'Se le debe a los entregadores'],
    ['Sin entregador (pedidos)', s.sin_entregador.pedidos, '#,##0', 'No se pueden pagar hasta asignarlos'],
    ['Sin entregador (importe)', s.sin_entregador.total, MONEY, '']
  ]);
  ws.getCell(`A${r}`).value = 'Por entregador';
  ws.getCell(`A${r}`).font = { bold: true, size: 12 };
  const head = ws.getRow(r + 1);
  head.values = ['Entregador', 'Pedidos', 'Delivery', 'Pagado', 'Pendiente'];
  styleHeaderRow(head);
  data.entregadores.forEach((e, i) => {
    const row = ws.getRow(r + 2 + i);
    row.values = [e.nombre, e.pedidos, e.total, e.pagado, e.pendiente];
    [3, 4, 5].forEach(c => { row.getCell(c).numFmt = MONEY; });
  });

  const wp = wb.addWorksheet('Pedidos', { views: [{ state: 'frozen', ySplit: 4 }] });
  wp.columns = [{ width: 8 }, { width: 12 }, { width: 24 }, { width: 30 }, { width: 18 }, { width: 12 }, { width: 14 }, { width: 10 }];
  wp.getCell('A1').value = 'Pedidos delivery';
  wp.getCell('A1').font = { bold: true, size: 14 };
  wp.getCell('A2').value = `${subtitle} · por fecha de confirmación, sin anulados`;
  wp.getCell('A2').font = noteFont;
  const ph = wp.getRow(4);
  ph.values = ['#', 'Fecha', 'Entregador', 'Cliente', 'Zona', 'Situación', 'Delivery', 'Pago #'];
  styleHeaderRow(ph);
  const all = [...data.pedidos, ...data.sin_entregador];
  all.forEach((p, i) => {
    const row = wp.getRow(5 + i);
    row.values = [p.idpedido, toDate(p.fecha), p.entregador || 'Sin entregador', p.cliente, p.zona_nombre || '', p.identregador === null ? 'Sin entregador' : p.pagado ? 'Pagado' : 'Pendiente', p.monto_delivery, p.idpago_delivery || ''];
    row.getCell(2).numFmt = 'dd/mm/yyyy';
    row.getCell(7).numFmt = MONEY;
  });
  const last = 4 + all.length;
  if (all.length) {
    [['PENDIENTE DE PAGAR', 'Pendiente', s.pendiente], ['Ya pagado', 'Pagado', s.pagado], ['Sin entregador', 'Sin entregador', s.sin_entregador.total]].forEach(([label, key, result], i) => {
      const row = wp.getRow(last + 2 + i);
      row.getCell(6).value = label;
      row.getCell(7).value = { formula: `SUMIFS(G5:G${last},F5:F${last},"${key}")`, result };
      row.getCell(7).numFmt = MONEY;
      row.font = { bold: i === 0 };
    });
    wp.autoFilter = `A4:H${last}`;
  }

  const wg = wb.addWorksheet('Pagos', { views: [{ state: 'frozen', ySplit: 4 }] });
  wg.columns = [{ width: 8 }, { width: 18 }, { width: 24 }, { width: 24 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 11 }, { width: 30 }];
  wg.getCell('A1').value = 'Pagos realizados';
  wg.getCell('A1').font = { bold: true, size: 14 };
  wg.getCell('A2').value = `${subtitle} · los anulados volvieron a la caja`;
  const gh = wg.getRow(4);
  gh.values = ['#', 'Fecha', 'Entregador', 'Período', 'Pedidos', 'Total', 'Forma de pago', 'Estado', 'Motivo de anulación'];
  styleHeaderRow(gh);
  data.pagos.forEach((p, i) => {
    const row = wg.getRow(5 + i);
    row.values = [p.idpago_delivery, p.fecha, p.entregador, `${isoToText(p.fecha_desde)} al ${isoToText(p.fecha_hasta)}`, p.cantidad_pedidos, p.total, p.forma_pago, p.estado === 'anulado' ? 'Anulado' : 'Pagado', p.motivo_anulado || ''];
    row.getCell(6).numFmt = MONEY;
    if (p.estado === 'anulado') row.font = { color: { argb: 'FF8A9590' }, strike: true };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
