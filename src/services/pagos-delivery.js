import { pool } from '../config/database.js';
import { fail, id, textRequired } from './pedidos.js';
import { auditar } from './auditoria.js';

// Pagos a delivery: lo cobrado por delivery (pedido.monto_delivery) es del entregador.
// Cuentan los pedidos DELIVERY confirmados y no anulados, por fecha de confirmación, con delivery > 0.
// Pagar crea un Gasto "Pago a delivery" (sale de la caja abierta) y guarda qué pedidos incluye;
// un pedido no puede estar en dos pagos activos. Anular el pago anula el gasto (vuelve a la caja).
export const GASTO_TIPO = 'Pago a delivery';
const number = value => Number(value || 0);
const isoText = iso => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const pedidosSql = (extra = '') => `
  SELECT p.idpedido, to_char(p.fecha_confirmado,'YYYY-MM-DD') AS fecha, to_char(p.fecha_confirmado,'HH24:MI') AS hora,
    p.estado::text AS estado, p.monto_delivery, p.monto_total, p.zona_nombre, p.direccion_entrega,
    cl.nombre_completo AS cliente, p.fk_identregador_delivery AS identregador, e.nombre_completo AS entregador,
    pdp.fk_idpago_delivery AS idpago_delivery
  FROM pedido p
  JOIN cliente cl ON cl.idcliente = p.fk_idcliente
  LEFT JOIN entregador_delivery e ON e.identregador_delivery = p.fk_identregador_delivery
  LEFT JOIN pago_delivery_pedido pdp ON pdp.fk_idpedido = p.idpedido AND pdp.activo
  WHERE p.tipo_entrega = 'DELIVERY' AND p.estado NOT IN ('abierto','cancelado') AND p.monto_delivery > 0
    AND p.fecha_confirmado >= $1::date AND p.fecha_confirmado < ($2::date + INTERVAL '1 day') ${extra}
  ORDER BY p.fecha_confirmado, p.idpedido`;

export async function resumenDelivery(inicio, fin, { entregador = null } = {}) {
  const params = [inicio, fin];
  const [pedidos, pagos, filtro] = await Promise.all([
    pool.query(pedidosSql(), params),
    pool.query(`SELECT pd.idpago_delivery, to_char(pd.fecha_creado,'YYYY-MM-DD HH24:MI') AS fecha, pd.fk_identregador_delivery AS identregador,
        e.nombre_completo AS entregador, to_char(pd.fecha_desde,'YYYY-MM-DD') AS fecha_desde, to_char(pd.fecha_hasta,'YYYY-MM-DD') AS fecha_hasta,
        pd.cantidad_pedidos, pd.total, f.nombre AS forma_pago, pd.estado, pd.creado_por, pd.motivo_anulado, pd.fk_idgasto
      FROM pago_delivery pd JOIN entregador_delivery e ON e.identregador_delivery = pd.fk_identregador_delivery
      JOIN forma_pago f ON f.idforma_pago = pd.fk_idforma_pago
      WHERE pd.fecha_creado >= $1::date AND pd.fecha_creado < ($2::date + INTERVAL '1 day') AND ($3::int IS NULL OR pd.fk_identregador_delivery = $3)
      ORDER BY pd.fecha_creado DESC, pd.idpago_delivery DESC`, [inicio, fin, entregador]),
    entregador ? pool.query('SELECT nombre_completo FROM entregador_delivery WHERE identregador_delivery=$1', [entregador]) : Promise.resolve({ rows: [] })
  ]);
  const rows = pedidos.rows.map(row => ({ ...row, monto_delivery: number(row.monto_delivery), monto_total: number(row.monto_total), pagado: row.idpago_delivery !== null }));
  // Pedidos sin entregador: no se le pueden pagar a nadie hasta asignarlos (se muestran siempre, aun con filtro).
  const sinEntregador = rows.filter(row => row.identregador === null);
  const asignados = rows.filter(row => row.identregador !== null && (!entregador || row.identregador === entregador));
  const byCourier = new Map();
  for (const row of asignados) {
    const item = byCourier.get(row.identregador) || { id: row.identregador, nombre: row.entregador, pedidos: 0, total: 0, pagado: 0, pendiente: 0, pendientes: 0 };
    item.pedidos += 1; item.total += row.monto_delivery;
    if (row.pagado) item.pagado += row.monto_delivery; else { item.pendiente += row.monto_delivery; item.pendientes += 1; }
    byCourier.set(row.identregador, item);
  }
  const entregadores = [...byCourier.values()].sort((a, b) => b.pendiente - a.pendiente || a.nombre.localeCompare(b.nombre));
  const sum = (list, key) => list.reduce((acc, item) => acc + item[key], 0);
  return {
    inicio, fin, filtro: entregador ? `Entregador: ${filtro.rows[0]?.nombre_completo || `#${entregador}`}` : null,
    resumen: {
      pedidos: asignados.length, total: sum(asignados, 'monto_delivery'),
      pagado: sum(asignados.filter(row => row.pagado), 'monto_delivery'),
      pendiente: sum(asignados.filter(row => !row.pagado), 'monto_delivery'),
      sin_entregador: { pedidos: sinEntregador.length, total: sum(sinEntregador, 'monto_delivery') }
    },
    entregadores, pedidos: asignados, sin_entregador: sinEntregador,
    pagos: pagos.rows.map(row => ({ ...row, total: number(row.total) }))
  };
}

// Delivery ya cobrado al cliente (pedido pagado) y todavía no pagado al entregador: está en caja pero no es del local.
export async function deliveryPendienteDeCaja(c = pool) {
  const { rows: [row] } = await c.query(`SELECT count(*)::int AS pedidos, COALESCE(sum(p.monto_delivery),0) AS total
    FROM pedido p WHERE p.tipo_entrega='DELIVERY' AND p.estado='pagado' AND p.monto_delivery > 0
      AND NOT EXISTS (SELECT 1 FROM pago_delivery_pedido pdp WHERE pdp.fk_idpedido=p.idpedido AND pdp.activo)`);
  return { pedidos: row.pedidos, total: number(row.total) };
}

export async function pagarDelivery(c, body, user) {
  const entregadorId = id(body?.fk_identregador_delivery), formaId = id(body?.fk_idforma_pago);
  const { inicio, fin } = body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fin || '') || inicio > fin) fail('Ingresá un rango de fechas válido');
  const courier = (await c.query('SELECT nombre_completo FROM entregador_delivery WHERE identregador_delivery=$1', [entregadorId])).rows[0];
  if (!courier) fail('Entregador no encontrado', 404);
  if (!(await c.query('SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND activo AND es_egreso', [formaId])).rowCount) fail('Seleccioná una forma de pago activa para egresos');
  if (!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount) fail('Abrí una caja antes de pagar al entregador');
  const tipo = (await c.query('SELECT idgasto_tipo FROM gasto_tipo WHERE lower(nombre)=lower($1)', [GASTO_TIPO])).rows[0];
  if (!tipo) fail(`Falta el tipo de gasto "${GASTO_TIPO}". Corré la migración de pagos a delivery`, 500);
  // Bloquea los pedidos pendientes para que dos pagos simultáneos no incluyan el mismo pedido.
  const { rows } = await c.query(`SELECT p.idpedido, p.monto_delivery FROM pedido p
    WHERE p.tipo_entrega='DELIVERY' AND p.estado NOT IN ('abierto','cancelado') AND p.monto_delivery > 0 AND p.fk_identregador_delivery=$3
      AND p.fecha_confirmado >= $1::date AND p.fecha_confirmado < ($2::date + INTERVAL '1 day')
      AND NOT EXISTS (SELECT 1 FROM pago_delivery_pedido pdp WHERE pdp.fk_idpedido=p.idpedido AND pdp.activo)
    ORDER BY p.idpedido FOR UPDATE OF p`, [inicio, fin, entregadorId]);
  if (!rows.length) fail('No hay delivery pendiente de pagar a este entregador en el período', 409);
  const total = rows.reduce((sum, row) => sum + number(row.monto_delivery), 0);
  // Lo que se ve en pantalla debe coincidir con lo que se paga (si alguien cobró o asignó en el medio, se avisa).
  if (body.total !== undefined && Number(body.total) !== total) fail(`El pendiente cambió a ${total.toLocaleString('es-PY')} Gs. Volvé a cargar antes de pagar`, 409);
  const descripcion = `Pago a delivery ${courier.nombre_completo} · ${rows.length} pedidos del ${isoText(inicio)} al ${isoText(fin)}`.slice(0, 500);
  const gasto = (await c.query(`INSERT INTO gasto(fk_idgasto_tipo,fk_idforma_pago,fecha_gasto,descripcion,total_gasto,estado,creado_por)
    VALUES($1,$2,CURRENT_DATE,$3,$4,'pagado',$5) RETURNING idgasto`, [tipo.idgasto_tipo, formaId, descripcion, total, user.login])).rows[0];
  const pago = (await c.query(`INSERT INTO pago_delivery(fk_identregador_delivery,fecha_desde,fecha_hasta,cantidad_pedidos,total,fk_idforma_pago,fk_idgasto,creado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING idpago_delivery`, [entregadorId, inicio, fin, rows.length, total, formaId, gasto.idgasto, user.login])).rows[0];
  for (const row of rows) {
    await c.query('INSERT INTO pago_delivery_pedido(fk_idpago_delivery,fk_idpedido,monto_delivery) VALUES($1,$2,$3)', [pago.idpago_delivery, row.idpedido, row.monto_delivery]);
  }
  return { pago: await pagoDelivery(c, pago.idpago_delivery) };
}

export async function anularPagoDelivery(c, pagoId, body, user) {
  const motivo = textRequired(body?.motivo, 'El motivo');
  if (motivo.length > 500) fail('El motivo admite hasta 500 caracteres');
  const pago = (await c.query('SELECT * FROM pago_delivery WHERE idpago_delivery=$1 FOR UPDATE', [id(pagoId)])).rows[0];
  if (!pago) fail('Pago no encontrado', 404);
  if (pago.estado === 'anulado') fail('El pago ya fue anulado', 409);
  if (!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount) fail('Abrí una caja antes de anular el pago');
  // Anular el gasto genera la reversión en la caja abierta (la plata vuelve a caja).
  await c.query("UPDATE gasto SET estado='anulado',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado=$2 WHERE idgasto=$3 AND estado='pagado'", [user.login, motivo, pago.fk_idgasto]);
  await c.query("UPDATE pago_delivery SET estado='anulado',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado=$2 WHERE idpago_delivery=$3", [user.login, motivo, pago.idpago_delivery]);
  await c.query('UPDATE pago_delivery_pedido SET activo=false WHERE fk_idpago_delivery=$1', [pago.idpago_delivery]);
  await auditar(c, user, { accion: 'PAGO_DELIVERY_ANULADO', entidad: 'pago_delivery', id: pago.idpago_delivery, motivo,
    antes: { estado: 'pagado', total: number(pago.total), pedidos: pago.cantidad_pedidos, gasto: pago.fk_idgasto }, despues: { estado: 'anulado' } });
  return { pago: await pagoDelivery(c, pago.idpago_delivery) };
}

// Asignar o cambiar el entregador de un pedido delivery (también ya pagado por el cliente), si no está en un pago activo.
export async function asignarEntregador(c, pedidoId, body, user) {
  const entregadorId = id(body?.fk_identregador_delivery);
  const pedido = (await c.query(`SELECT p.idpedido, p.tipo_entrega, p.estado, p.fk_identregador_delivery, e.nombre_completo AS anterior
    FROM pedido p LEFT JOIN entregador_delivery e ON e.identregador_delivery=p.fk_identregador_delivery WHERE p.idpedido=$1 FOR UPDATE OF p`, [id(pedidoId)])).rows[0];
  if (!pedido) fail('Pedido no encontrado', 404);
  if (pedido.tipo_entrega !== 'DELIVERY' || pedido.estado === 'cancelado') fail('Solo se asigna entregador a pedidos delivery no anulados');
  if ((await c.query('SELECT 1 FROM pago_delivery_pedido WHERE fk_idpedido=$1 AND activo', [pedido.idpedido])).rowCount) fail('El pedido ya está en un pago al entregador. Anulá ese pago para cambiarlo', 409);
  const courier = (await c.query('SELECT nombre_completo FROM entregador_delivery WHERE identregador_delivery=$1 AND activo', [entregadorId])).rows[0];
  if (!courier) fail('Seleccioná un entregador activo');
  if (pedido.fk_identregador_delivery === entregadorId) return { idpedido: pedido.idpedido, entregador: courier.nombre_completo };
  await c.query('UPDATE pedido SET fk_identregador_delivery=$1 WHERE idpedido=$2', [entregadorId, pedido.idpedido]);
  await auditar(c, user, { accion: 'ENTREGADOR_ASIGNADO', entidad: 'pedido', id: pedido.idpedido,
    antes: { entregador: pedido.anterior }, despues: { entregador: courier.nombre_completo } });
  return { idpedido: pedido.idpedido, entregador: courier.nombre_completo };
}

export async function pagoDelivery(c, pagoId) {
  const pago = (await c.query(`SELECT pd.*, e.nombre_completo AS entregador, e.telefono AS entregador_telefono, f.nombre AS forma_pago,
      to_char(pd.fecha_desde,'YYYY-MM-DD') AS fecha_desde, to_char(pd.fecha_hasta,'YYYY-MM-DD') AS fecha_hasta
    FROM pago_delivery pd JOIN entregador_delivery e ON e.identregador_delivery=pd.fk_identregador_delivery
    JOIN forma_pago f ON f.idforma_pago=pd.fk_idforma_pago WHERE pd.idpago_delivery=$1`, [id(pagoId)])).rows[0];
  if (!pago) fail('Pago no encontrado', 404);
  pago.total = number(pago.total);
  pago.pedidos = (await c.query(`SELECT pdp.fk_idpedido AS idpedido, pdp.monto_delivery, to_char(p.fecha_confirmado,'YYYY-MM-DD') AS fecha,
      cl.nombre_completo AS cliente, p.zona_nombre
    FROM pago_delivery_pedido pdp JOIN pedido p ON p.idpedido=pdp.fk_idpedido JOIN cliente cl ON cl.idcliente=p.fk_idcliente
    WHERE pdp.fk_idpago_delivery=$1 ORDER BY p.fecha_confirmado, p.idpedido`, [pago.idpago_delivery])).rows.map(row => ({ ...row, monto_delivery: number(row.monto_delivery) }));
  return pago;
}

export async function opcionesDelivery() {
  const [entregadores, formas, caja] = await Promise.all([
    pool.query('SELECT identregador_delivery AS id, nombre_completo AS nombre, activo FROM entregador_delivery ORDER BY activo DESC, nombre_completo'),
    pool.query('SELECT idforma_pago, nombre, es_default FROM forma_pago WHERE activo AND es_egreso ORDER BY orden, nombre'),
    pool.query("SELECT 1 FROM caja_gral WHERE estado='abierta'")
  ]);
  return { entregadores: entregadores.rows, formas: formas.rows, caja_abierta: caja.rowCount > 0 };
}
