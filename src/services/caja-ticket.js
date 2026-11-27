import { writer, renderTicket, money, quantity, muted } from './ticket-pdf.js';

const timeZone = process.env.RESTAURANT_TIMEZONE || process.env.TZ || 'America/Asuncion';
const date = value => value ? new Intl.DateTimeFormat('es-PY', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
const n = value => Number(value || 0);
// Diferencia con signo: + sobra, - falta.
const signed = value => value === 0 ? 'Gs. 0' : `${value > 0 ? '+' : '-'} ${money(Math.abs(value))}`;

// Cierre de caja pensado para el dueño: ventas sin delivery (el delivery aparte), por usuario, POS rendido,
// pago a los entregadores, efectivo que debe haber contra lo contado y todas las diferencias juntas.
// Dibuja el ticket y devuelve la altura usada; sirve para medir y luego para dibujar en una sola página.
function layout(doc, data, printedAt) {
  const { caja, efectivoId, efectivoNombre = 'Efectivo', arqueos, egresos, categorias, productos, anulados } = data;
  const usuarios = data.usuarios || { formas: [], filas: [], totales: { formas: {}, delivery_formas: {}, total_cobrado: 0, delivery: 0 } };
  const descuentos = data.descuentos || { total: 0, cantidad: 0 };
  const pos = data.pos || [];
  const delivery = data.delivery || { rendiciones: 0, ganancia: 0, entregado: 0, pagado_local: 0, pagos_aparte: 0 };
  const insumos = data.insumos || [];

  const w = writer(doc);
  const { text, rule, space, end } = w;
  const pair = (label, value, { bold = false, size = bold ? 9.5 : 8.5 } = {}) => w.pair(label, value, { bold, size, leftRatio: .55 });
  const detail = (label, value) => w.pair(`   ${label}`, value, { size: 8, leftRatio: .55, gap: 2 });
  const section = title => { rule(); text(title, { size: 9.5, bold: true, gap: 4 }); };
  const note = value => text(value, { size: 7.5, color: muted, gap: 3 });
  const empty = (value = 'Sin movimientos.') => text(value, { size: 8, color: muted });

  const totales = usuarios.totales;
  const cobrado = n(totales.total_cobrado), deliveryCobrado = n(totales.delivery);
  const sinDelivery = cobrado - deliveryCobrado;

  text('CIERRE DE CAJA', { size: 15, bold: true, align: 'center', gap: 1 });
  text(`CAJA #${caja.idcaja_gral} · COMPROBANTE NO FISCAL`, { size: 7, align: 'center', color: muted, gap: 6 });
  pair('Fecha inicio', date(caja.fecha_apertura));
  pair('Fecha fin', date(caja.fecha_cierre));
  pair('Abierta por', caja.creado_por || '—');
  pair('Cerrada por', caja.cerrado_por || '—');
  pair('Impreso', date(printedAt));

  // 1. Ventas: lo importante es lo vendido sin delivery; el delivery va aparte.
  section('VENTAS');
  w.pair('SIN DELIVERY', money(sinDelivery), { bold: true, size: 11, leftRatio: .55 });
  pair(descuentos.cantidad ? `Descuentos aplicados (${descuentos.cantidad})` : 'Descuentos aplicados', descuentos.total ? `- ${money(descuentos.total)}` : 'Sin descuentos');
  pair('Delivery cobrado', money(deliveryCobrado));
  pair('TOTAL COBRADO', money(cobrado), { bold: true });

  // 2. Por usuario (quien cargó el pedido): total sin delivery y su detalle por forma de pago.
  section('VENTAS POR USUARIO (SIN DELIVERY)');
  if (!usuarios.filas.length) empty();
  for (const fila of usuarios.filas) {
    pair(fila.nombre, money(n(fila.total_cobrado) - n(fila.delivery)), { bold: true });
    for (const forma of usuarios.formas) {
      const monto = n(fila.formas[forma]) - n(fila.delivery_formas?.[forma]);
      if (monto) detail(forma, money(monto));
    }
    space(2);
  }
  if (usuarios.filas.length > 1) {
    text('Total por forma de pago', { size: 8.5, bold: true, gap: 2 });
    for (const forma of usuarios.formas) {
      const monto = n(totales.formas[forma]) - n(totales.delivery_formas?.[forma]);
      if (monto) detail(forma, money(monto));
    }
  }

  // 3. Delivery: lo cobrado a los clientes y lo que se llevaron o se les pagó a los entregadores.
  section('DELIVERY');
  pair('Cobrado a clientes', money(deliveryCobrado), { bold: true });
  for (const forma of usuarios.formas) if (n(totales.delivery_formas?.[forma])) detail(forma, money(totales.delivery_formas[forma]));
  pair(`Ganancia de entregadores${delivery.rendiciones ? ` (${delivery.rendiciones} rend.)` : ''}`, money(delivery.ganancia));
  pair('Efectivo entregado por entregadores', money(delivery.entregado));
  if (delivery.pagos_aparte) pair('Pagos a delivery aparte', money(delivery.pagos_aparte));
  const pagadoLocal = delivery.pagado_local + delivery.pagos_aparte;
  pair('PAGÓ EL LOCAL', money(pagadoLocal), { bold: true });
  if (!pagadoLocal && delivery.rendiciones) note('Gs. 0: los entregadores se quedaron con su delivery del efectivo cobrado y entregaron el resto.');

  // 4. POS: lo rendido según el resumen impreso de cada máquina contra lo del sistema.
  section('POS RENDIDO');
  if (!pos.length) empty('Sin cobros con POS.');
  let posInformado = 0, posSistema = 0;
  for (const maquina of pos) {
    posInformado += maquina.informado; posSistema += maquina.sistema;
    const diferencia = maquina.informado - maquina.sistema;
    pair(maquina.nombre, money(maquina.informado), { bold: true });
    detail('Según sistema', money(maquina.sistema));
    detail('Diferencia', diferencia ? signed(diferencia) : 'Coincide');
  }
  if (pos.length) pair('TOTAL POS', money(posInformado), { bold: true });

  // 5. Arqueo (cajas cerradas con conteo de billetes): plata real contra lo vendido.
  // Ingresado = billetes + monedas − saldo inicial + egresos en efectivo + POS; diferencia = ingresado − vendido con delivery.
  const arqueo = data.arqueo;
  if (arqueo && caja.cierre_diferencia !== null && caja.cierre_diferencia !== undefined) {
    const contadoCaja = n(caja.cierre_billetes) + n(caja.cierre_monedas);
    const diferencia = n(caja.cierre_diferencia);
    section('ARQUEO DE CIERRE');
    text('Billetes', { size: 8.5, bold: true, gap: 2 });
    if (!arqueo.billetes.length) empty('Sin billetes.');
    for (const b of arqueo.billetes) detail(`${b.cantidad} × ${money(b.denominacion)}`, money(b.cantidad * b.denominacion));
    if (n(caja.cierre_monedas)) detail('Monedas / otros', money(caja.cierre_monedas));
    pair('Billetes y monedas', money(contadoCaja), { bold: true });
    pair('- Saldo inicial', money(caja.monto_inicial));
    pair('+ Egresos', money(caja.cierre_egresos));
    for (const e of arqueo.egresos) detail(`${e.etiqueta}${e.cantidad ? ` (${e.cantidad})` : ''}`, money(e.monto));
    pair('+ POS', money(caja.cierre_pos));
    for (const m of arqueo.maquinas_pos) if (m.contado !== null) detail(m.nombre, money(m.contado));
    pair('INGRESADO', money(n(caja.cierre_vendido) + diferencia), { bold: true });
    pair('Vendido sin delivery', money(n(caja.cierre_vendido) - n(caja.cierre_delivery)));
    pair('+ Delivery', money(caja.cierre_delivery));
    pair('VENDIDO', money(caja.cierre_vendido), { bold: true });
    rule();
    w.pair('DIFERENCIA', diferencia ? signed(diferencia) : 'Cuadra', { bold: true, size: 12, leftRatio: .55 });
    note(diferencia > 0 ? 'Sobra plata respecto de lo vendido.' : diferencia < 0 ? 'Falta plata respecto de lo vendido.' : 'La plata contada coincide con lo vendido.');
    for (const maquina of pos) if (maquina.informado !== maquina.sistema) note(`POS ${maquina.nombre} en rendiciones: ${signed(maquina.informado - maquina.sistema)} contra el sistema.`);
  } else legacyCash();

  // Cierres anteriores al conteo por billetes: efectivo esperado contra contado y resumen de diferencias.
  function legacyCash() {
  const cashRow = arqueos.find(row => row.fk_idforma_pago === efectivoId);
  const esperado = n(cashRow?.monto_esperado ?? caja.monto_inicial);
  const contado = n(cashRow?.monto_contado);
  const difEfectivo = n(cashRow?.diferencia);
  section(`${efectivoNombre.toUpperCase()} EN CAJA`);
  pair('Inicio de caja', money(caja.monto_inicial));
  pair('+ Ingresos', money(cashRow?.total_ingresos));
  pair('- Egresos', money(cashRow?.total_egresos));
  pair('DEBE HABER', money(esperado), { bold: true });
  pair('CONTADO AL CERRAR', money(contado), { bold: true });
  pair('Diferencia', difEfectivo ? signed(difEfectivo) : 'Coincide');

  // 6. Otros egresos (el pago a delivery ya está arriba).
  const otros = egresos.filter(row => row.origen !== 'delivery');
  section('OTROS EGRESOS');
  if (!otros.length) empty('Sin otros egresos.');
  for (const row of otros) pair(`${row.etiqueta} (${row.cantidad})`, money(row.monto));

  // 7. Todas las diferencias juntas.
  section('RESUMEN DE DIFERENCIAS');
  const diferencias = [];
  if (difEfectivo) diferencias.push([efectivoNombre, difEfectivo]);
  for (const row of arqueos) if (row.fk_idforma_pago !== efectivoId && n(row.diferencia)) diferencias.push([row.forma_pago, n(row.diferencia)]);
  for (const maquina of pos) if (maquina.informado !== maquina.sistema) diferencias.push([`POS ${maquina.nombre}`, maquina.informado - maquina.sistema]);
  if (!diferencias.length) text('Sin diferencias: todo cuadra.', { size: 8.5, bold: true });
  for (const [label, value] of diferencias) pair(label, signed(value));
  if (diferencias.length) pair('TOTAL DIFERENCIAS', signed(diferencias.reduce((sum, [, value]) => sum + value, 0)), { bold: true });
  }

  section('TOP CATEGORÍAS');
  if (!categorias.length) empty();
  categorias.forEach((row, index) => pair(`${index + 1}. ${row.nombre} (${row.cantidad})`, money(row.importe)));

  section('PRODUCTOS MÁS VENDIDOS');
  if (!productos.length) empty();
  productos.forEach((row, index) => pair(`${index + 1}. ${row.nombre} (${row.cantidad})`, money(row.importe)));

  section(`PEDIDOS ANULADOS (${anulados.length})`);
  if (!anulados.length) text('Sin pedidos anulados.', { size: 8, color: muted });
  for (const row of anulados) {
    pair(`#${row.idpedido} · ${date(row.fecha_anulado)}`, money(row.monto_total));
    text(`${row.tipo_entrega}${row.mesa_numero ? ` · Mesa ${row.mesa_numero}` : ''} · ${row.anulado_por}${row.motivo_anulado ? ` · ${row.motivo_anulado}` : ''}`, { size: 7.5, color: muted, gap: 4 });
  }

  section('INSUMOS USADOS');
  if (!insumos.length) empty('Sin insumos registrados en los productos vendidos.');
  for (const row of insumos) w.pair(row.nombre, `${quantity(row.cantidad)} ${row.unidad}`, { size: 8.5, leftRatio: .68 });

  rule();
  text('Fin del cierre de caja', { align: 'center', gap: 0 });
  return end();
}

export function renderCajaTicket(data, printedAt = new Date(), config) {
  return renderTicket(layout, data, `Cierre de caja #${data.caja.idcaja_gral}`, printedAt, config);
}
