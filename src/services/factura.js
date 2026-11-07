import { pool } from '../config/database.js';
import { fail, id, order, textRequired } from './pedidos.js';
import * as sisfe from './sisfe.js';
import { auditar } from './auditoria.js';

const UNIDAD_MEDIDA = 77;
const CANCELACION_MAX_HORAS = 48;
const enProceso = new Set();

// ---- RUC ----------------------------------------------------------------

// Dígito verificador del RUC (módulo 11, base 11).
export function digitoVerificador(base) {
  let sum = 0;
  let factor = 2;
  for (const digit of String(base).split('').reverse()) {
    sum += Number(digit) * factor;
    factor = factor === 11 ? 2 : factor + 1;
  }
  const rest = sum % 11;
  return rest > 1 ? 11 - rest : 0;
}

export function partesRuc(ruc) {
  const match = /^(\d{1,9})(?:-(\d))?$/.exec(String(ruc || '').trim());
  if (!match) return null;
  return { base: match[1], dv: match[2] === undefined ? null : Number(match[2]) };
}

// Devuelve "base-dv"; completa el dígito si falta y rechaza uno incorrecto.
export function normalizarRuc(ruc) {
  const parts = partesRuc(ruc);
  if (!parts) fail('RUC inválido: usá el formato 1234567-8');
  const dv = digitoVerificador(parts.base);
  if (parts.dv !== null && parts.dv !== dv) fail(`El dígito verificador del RUC no coincide (debería ser ${dv})`);
  return `${parts.base}-${dv}`;
}

// ---- Líneas de la factura -------------------------------------------------

const clip = (text, max) => String(text).trim().slice(0, max);

// El descuento del pedido se reparte en proporción al importe de cada línea. SISFE admite descuento
// por unidad, así que una línea con resto se divide en dos para que el total cuadre al guaraní.
function repartirDescuento(lines, descuento) {
  if (!descuento) return lines.map(line => ({ ...line, descuento: 0 }));
  const gross = lines.reduce((sum, line) => sum + line.cantidad * line.precio_unitario, 0);
  if (descuento > gross) fail('El descuento supera el total del pedido');
  const shares = lines.map(line => Number(BigInt(descuento) * BigInt(line.cantidad * line.precio_unitario) / BigInt(gross)));
  let left = descuento - shares.reduce((sum, share) => sum + share, 0);
  for (let index = 0; left > 0; index = (index + 1) % lines.length) {
    if (shares[index] < lines[index].cantidad * lines[index].precio_unitario) { shares[index] += 1; left -= 1; }
  }
  return lines.flatMap((line, index) => {
    const share = shares[index];
    const base = Math.floor(share / line.cantidad);
    const rest = share % line.cantidad;
    if (!rest) return [{ ...line, descuento: base }];
    return [{ ...line, cantidad: rest, descuento: base + 1 }, { ...line, cantidad: line.cantidad - rest, descuento: base }];
  });
}

export function lineasDesdePedido(pedido) {
  const lines = [];
  for (const detail of pedido.detalles) {
    lines.push({ codigo: String(detail.fk_idproducto_menu), descripcion: clip(detail.nombre_mostrado || detail.nombre, 250),
      cantidad: Number(detail.cantidad), precio_unitario: Number(detail.precio_venta) });
    for (const extra of detail.ingredientes || []) {
      if (extra.tipo_modificacion !== 'AGREGAR' || !Number(extra.precio_venta)) continue;
      lines.push({ codigo: `ING-${extra.idingrediente}`, descripcion: clip(`Adicional ${extra.nombre} (${detail.nombre})`, 250),
        cantidad: Number(detail.cantidad), precio_unitario: Number(extra.precio_venta) });
    }
    if (Number(detail.precio_observacion) > 0) {
      lines.push({ codigo: `OBS-${detail.iddetalle_pedido}`, descripcion: clip(`Adicional: ${detail.observaciones || 'observación'} (${detail.nombre})`, 250),
        cantidad: Number(detail.cantidad), precio_unitario: Number(detail.precio_observacion) });
    }
  }
  if (Number(pedido.monto_delivery) > 0) lines.push({ codigo: 'DELIVERY', descripcion: 'Servicio de delivery', cantidad: 1, precio_unitario: Number(pedido.monto_delivery) });
  if (Number(pedido.monto_recargo) > 0) lines.push({ codigo: 'RECARGO', descripcion: 'Recargo', cantidad: 1, precio_unitario: Number(pedido.monto_recargo) });
  return repartirDescuento(lines, Number(pedido.monto_descuento) || 0)
    .map(line => ({ ...line, unidad_medida: UNIDAD_MEDIDA, iva_tipo: 1, iva_base: 100, iva: 10,
      subtotal: line.cantidad * (line.precio_unitario - line.descuento) }));
}

export function totales(lines) {
  const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
  const iva10 = Math.round(total / 11);
  return { total, total_iva10: iva10, base_gravada10: total - iva10 };
}

// ---- Receptor -------------------------------------------------------------

function receptorDesdeCliente(cliente) {
  if (!cliente) return { fk_idcliente: null, ruc: '', razon_social: 'Sin Nombre', direccion: '', email: '', celular: '' };
  return {
    fk_idcliente: cliente.idcliente,
    ruc: cliente.ruc || '',
    razon_social: cliente.razon_social || cliente.nombre_completo || 'Sin Nombre',
    direccion: cliente.direccion || '',
    email: cliente.email || '',
    celular: cliente.telefono || ''
  };
}

// Con RUC el receptor es contribuyente; sin RUC se emite como innominado (consumidor final).
function clasificarReceptor(receptor) {
  if (!receptor.ruc) return { contribuyente: false, tipo_contribuyente: null, tipo_operacion: 2, ruc: null, razon_social: 'Sin Nombre' };
  const ruc = normalizarRuc(receptor.ruc);
  const juridica = Number(ruc.split('-')[0]) >= 50000000;
  return { contribuyente: true, tipo_contribuyente: juridica ? 2 : 1, tipo_operacion: juridica ? 1 : 2, ruc,
    razon_social: textRequired(receptor.razon_social, 'La razón social del cliente') };
}

// ---- Precarga -------------------------------------------------------------

async function pedidoFacturable(c, pedidoId) {
  const pedido = await order(c, pedidoId);
  if (pedido.estado === 'cancelado') fail('No se puede facturar un pedido cancelado', 409);
  if (!pedido.detalles.length) fail('El pedido no tiene productos para facturar', 409);
  return pedido;
}

export async function precargarDesdePedido(c, pedidoId) {
  const pedido = await pedidoFacturable(c, pedidoId);
  const detalles = lineasDesdePedido(pedido);
  const sums = totales(detalles);
  return {
    fk_idpedido: pedido.idpedido,
    pedido: { idpedido: pedido.idpedido, estado: pedido.estado, tipo_entrega: pedido.tipo_entrega, numero_mesa: pedido.numero_mesa, monto_total: Number(pedido.monto_total) },
    cliente: receptorDesdeCliente(pedido.cliente),
    detalles,
    ...sums,
    cuadra: sums.total === Number(pedido.monto_total)
  };
}

// ---- Lectura --------------------------------------------------------------

export async function obtenerFactura(c, facturaId) {
  const factura = (await c.query('SELECT * FROM factura WHERE idfactura=$1', [id(facturaId)])).rows[0];
  if (!factura) fail('Factura no encontrada', 404);
  factura.numero_completo = `${factura.establecimiento}-${factura.punto}-${String(factura.numero).padStart(7, '0')}`;
  factura.detalles = (await c.query('SELECT * FROM factura_detalle WHERE fk_idfactura=$1 ORDER BY idfactura_detalle', [factura.idfactura])).rows;
  return factura;
}

export async function facturaDelPedido(c, pedidoId) {
  const row = (await c.query("SELECT idfactura FROM factura WHERE fk_idpedido=$1 AND estado<>'cancelado'", [pedidoId])).rows[0];
  return row ? obtenerFactura(c, row.idfactura) : null;
}

// ---- Creación -------------------------------------------------------------

// Guarda la factura y reserva el número en la misma transacción; el envío a SISFE va después.
export async function crearFactura(c, body, user) {
  const pedidoId = id(body.fk_idpedido);
  await c.query('SELECT 1 FROM pedido WHERE idpedido=$1 FOR UPDATE', [pedidoId]);
  if (await facturaDelPedido(c, pedidoId)) fail('El pedido ya tiene una factura', 409);
  const pedido = await pedidoFacturable(c, pedidoId);
  const detalles = lineasDesdePedido(pedido);
  const sums = totales(detalles);
  if (sums.total !== Number(pedido.monto_total)) fail('El total de la factura no coincide con el del pedido', 409);

  const sent = body.cliente || {};
  const receptor = {
    fk_idcliente: sent.fk_idcliente ? id(sent.fk_idcliente) : null,
    ruc: String(sent.ruc || '').trim(),
    razon_social: String(sent.razon_social || '').trim(),
    direccion: clip(sent.direccion || '', 250),
    email: clip(sent.email || '', 150),
    celular: clip(sent.celular || '', 40)
  };
  if (receptor.fk_idcliente && !(await c.query('SELECT 1 FROM cliente WHERE idcliente=$1', [receptor.fk_idcliente])).rowCount) fail('Cliente no encontrado', 404);
  const clase = clasificarReceptor(receptor);

  const cfg = (await c.query('UPDATE datos_restaurante SET numero_actual=numero_actual+1 WHERE iddatos_restaurante=1 RETURNING establecimiento,punto,numero_actual')).rows[0];
  const factura = (await c.query(`INSERT INTO factura(fk_idpedido,fk_idcliente,cliente_ruc,cliente_razon_social,cliente_direccion,cliente_email,cliente_celular,
      contribuyente,tipo_contribuyente,tipo_operacion,establecimiento,punto,numero,total,base_gravada10,total_iva10,creado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING idfactura`,
  [pedidoId, receptor.fk_idcliente, clase.ruc, clase.razon_social, receptor.direccion || null, receptor.email || null, receptor.celular || null,
    clase.contribuyente, clase.tipo_contribuyente, clase.tipo_operacion, cfg.establecimiento, cfg.punto, cfg.numero_actual,
    sums.total, sums.base_gravada10, sums.total_iva10, user.login])).rows[0];
  for (const line of detalles) {
    await c.query(`INSERT INTO factura_detalle(fk_idfactura,codigo,descripcion,unidad_medida,cantidad,precio_unitario,descuento,iva_tipo,iva_base,iva,subtotal,creado_por)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [factura.idfactura, line.codigo, line.descripcion, line.unidad_medida, line.cantidad, line.precio_unitario, line.descuento, line.iva_tipo, line.iva_base, line.iva, line.subtotal, user.login]);
  }
  return { idfactura: factura.idfactura };
}

// ---- SISFE ----------------------------------------------------------------

const pad = value => String(value).padStart(2, '0');
const fechaIso = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

export function documentoSisfe(factura) {
  const cliente = factura.contribuyente
    ? { contribuyente: true, ruc: factura.cliente_ruc, razonSocial: factura.cliente_razon_social, tipoOperacion: factura.tipo_operacion,
      tipoContribuyente: factura.tipo_contribuyente, pais: 'PRY', codigo: String(factura.fk_idcliente || 0) }
    : { contribuyente: false, razonSocial: 'Sin Nombre', tipoOperacion: 2, documentoTipo: 5, documentoNumero: '0', pais: 'PRY', codigo: String(factura.fk_idcliente || 0) };
  if (factura.cliente_direccion) cliente.direccion = factura.cliente_direccion;
  if (factura.cliente_email) cliente.email = factura.cliente_email;
  if (factura.cliente_celular) cliente.celular = factura.cliente_celular;
  return {
    tipoDocumento: 1,
    establecimiento: factura.establecimiento,
    punto: factura.punto,
    numero: String(factura.numero).padStart(7, '0'),
    fecha: fechaIso(new Date(factura.fecha_emision)),
    tipoImpuesto: 1,
    tipoTransaccion: 1,
    moneda: 'PYG',
    cliente,
    factura: { presencia: 1 },
    items: factura.detalles.map(line => ({
      codigo: line.codigo, descripcion: line.descripcion, unidadMedida: line.unidad_medida, cantidad: Number(line.cantidad),
      precioUnitario: Number(line.precio_unitario), ivaTipo: line.iva_tipo, ivaBase: line.iva_base, iva: line.iva,
      ...(Number(line.descuento) ? { descuento: Number(line.descuento) } : {})
    })),
    condicion: { tipo: 1, entregas: [{ tipo: 1, monto: Number(factura.total), moneda: 'PYG' }] }
  };
}

async function guardarRespuesta(facturaId, document) {
  const estado = sisfe.estadoLocal(document.situacion);
  await pool.query(`UPDATE factura SET estado=$2,lote_id=$3,cdc=$4,respuesta_codigo=$5,respuesta_mensaje=$6,qr=$7 WHERE idfactura=$1`,
    [facturaId, estado, document.loteId ?? null, document.cdc || null, document.respuesta_codigo || null, document.respuesta_mensaje || document.estado || null, document.qr || null]);
}

async function guardarError(facturaId, error) {
  await pool.query("UPDATE factura SET estado='error',respuesta_mensaje=$2 WHERE idfactura=$1", [facturaId, clip(error.message, 500)]);
}

// Serializa las llamadas a SISFE por factura para evitar dobles envíos por doble clic.
async function exclusivo(facturaId, action) {
  if (enProceso.has(facturaId)) fail('La factura ya se está procesando', 409);
  enProceso.add(facturaId);
  try { return await action(); } finally { enProceso.delete(facturaId); }
}

// Crea el documento en SISFE como borrador (genera QR y PDF sin transmitir a SIFEN).
export async function emitirBorrador(facturaId) {
  return exclusivo(facturaId, async () => {
    const factura = await obtenerFactura(pool, facturaId);
    if (!['pendiente', 'error'].includes(factura.estado)) return factura;
    try {
      await guardarRespuesta(facturaId, await sisfe.crearLote(documentoSisfe(factura), { borrador: true }));
    } catch (error) { await guardarError(facturaId, error); throw error; }
    return obtenerFactura(pool, facturaId);
  });
}

export async function confirmarFactura(facturaId) {
  return exclusivo(facturaId, async () => {
    const factura = await obtenerFactura(pool, facturaId);
    if (factura.estado !== 'borrador') fail('Solo se puede confirmar una factura en borrador', 409);
    if (!factura.lote_id) fail('La factura no tiene lote en SISFE', 409);
    await pool.query("UPDATE factura SET estado='enviado' WHERE idfactura=$1", [facturaId]);
    try {
      await guardarRespuesta(facturaId, await sisfe.confirmarBorrador(factura.lote_id));
    } catch (error) {
      await pool.query("UPDATE factura SET estado='borrador',respuesta_mensaje=$2 WHERE idfactura=$1", [facturaId, clip(error.message, 500)]);
      throw error;
    }
    return obtenerFactura(pool, facturaId);
  });
}

export async function refrescarEstado(facturaId, user) {
  return exclusivo(facturaId, async () => {
    const factura = await obtenerFactura(pool, facturaId);
    if (!factura.cdc) fail('La factura todavía no tiene CDC', 409);
    const document = await sisfe.consultarEstado(factura.cdc);
    if (sisfe.estadoLocal(document.situacion) === 'cancelado' && factura.estado !== 'cancelado') {
      await pool.query("UPDATE factura SET estado='cancelado',fecha_cancelado=CURRENT_TIMESTAMP,cancelado_por=$2,motivo_cancelado='Cancelada en SIFEN' WHERE idfactura=$1", [facturaId, user.login]);
    } else if (factura.estado !== 'cancelado') {
      await guardarRespuesta(facturaId, { ...document, loteId: document.loteId ?? factura.lote_id });
    }
    return obtenerFactura(pool, facturaId);
  });
}

export async function cancelarFactura(facturaId, motivo, user) {
  const reason = textRequired(motivo, 'El motivo');
  if (reason.length < 5 || reason.length > 500) fail('El motivo debe tener entre 5 y 500 caracteres');
  return exclusivo(facturaId, async () => {
    const factura = await obtenerFactura(pool, facturaId);
    if (factura.estado !== 'aprobado') fail('Solo se puede cancelar una factura aprobada', 409);
    const horas = (Date.now() - new Date(factura.fecha_emision).getTime()) / 3600000;
    if (horas > CANCELACION_MAX_HORAS) fail(`Las facturas solo se pueden cancelar dentro de las ${CANCELACION_MAX_HORAS} horas de emitidas`, 409);
    await sisfe.cancelarDocumento(factura.cdc, reason);
    // SISFE ya la canceló: el registro de auditoría va en la misma transacción que el cambio de estado local.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE factura SET estado='cancelado',fecha_cancelado=CURRENT_TIMESTAMP,cancelado_por=$2,motivo_cancelado=$3 WHERE idfactura=$1", [facturaId, user.login, reason]);
      await auditar(client, user, { accion: 'FACTURA_CANCELADA', entidad: 'factura', id: facturaId, motivo: reason,
        antes: { estado: factura.estado, numero: `${factura.establecimiento}-${factura.punto}-${String(factura.numero).padStart(7, '0')}`, total: Number(factura.total), pedido: factura.fk_idpedido, cdc: factura.cdc },
        despues: { estado: 'cancelado' } });
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return obtenerFactura(pool, facturaId);
  });
}

export async function kudeDe(facturaId) {
  const factura = await obtenerFactura(pool, facturaId);
  if (!factura.cdc) fail('La factura todavía no tiene CDC', 409);
  return { factura, pdf: await sisfe.descargarKude(factura.cdc) };
}
