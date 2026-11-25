import { pool } from '../config/database.js';
import { fail, id, integer, textRequired, account, finishOrder, collect } from './pedidos.js';
import { registrarPago, tipoGastoDelivery, anularPagoDelivery } from './pagos-delivery.js';
import { auditar } from './auditoria.js';

// Rendición del entregador (fin del turno). Por cada pedido que llevó se registra el cobro al cliente con la forma
// que corresponda (efectivo, tarjeta o QR del POS del entregador) y se le paga su delivery en efectivo.
// Neto = efectivo cobrado − delivery: positivo lo entrega el entregador; negativo se lo paga el local.
// En la caja queda exactamente eso, porque los cobros entran como siempre y el delivery sale como gasto "Pago a delivery".
const number = value => Number(value || 0);
const MAX_PEDIDOS = 200;

// Pedidos del entregador que faltan rendir: delivery no anulado, sin rendición activa y con algo pendiente
// (la cuenta sin cobrar o el delivery sin pagarle).
const pendientesDe = courierCondition => `
  SELECT p.idpedido, p.fk_identregador_delivery AS identregador, p.fk_idcuenta, p.fk_idforma_pago_entrega, p.estado::text AS estado, p.monto_total, p.monto_delivery, p.version_web,
    to_char(COALESCE(p.fecha_confirmado, p.fecha_creado),'YYYY-MM-DD HH24:MI') AS fecha,
    cl.nombre_completo AS cliente, p.direccion_entrega, p.zona_nombre, cu.estado::text AS estado_cuenta,
    cu.total AS total_cuenta, cobrado_neto_cuenta(cu.idcuenta) AS cobrado,
    EXISTS (SELECT 1 FROM pago_delivery_pedido pdp WHERE pdp.fk_idpedido=p.idpedido AND pdp.activo) AS delivery_ya_pagado
  FROM pedido p
  JOIN cuenta cu ON cu.idcuenta = p.fk_idcuenta
  JOIN cliente cl ON cl.idcliente = p.fk_idcliente
  WHERE p.tipo_entrega='DELIVERY' AND p.estado NOT IN ('abierto','cancelado') AND ${courierCondition}
    AND NOT EXISTS (SELECT 1 FROM rendicion_delivery_pedido r WHERE r.fk_idpedido=p.idpedido AND r.activo)
    AND (cu.estado='abierta' OR (p.monto_delivery > 0 AND NOT EXISTS (SELECT 1 FROM pago_delivery_pedido pdp WHERE pdp.fk_idpedido=p.idpedido AND pdp.activo)))`;
const pendientesSql = pendientesDe('p.fk_identregador_delivery=$1');

const shape = row => {
  const saldo = row.estado_cuenta === 'abierta' ? Math.max(0, number(row.total_cuenta) - number(row.cobrado)) : 0;
  return { idpedido: row.idpedido, fk_idcuenta: row.fk_idcuenta, estado: row.estado, fecha: row.fecha, cliente: row.cliente,
    direccion_entrega: row.direccion_entrega, zona_nombre: row.zona_nombre, version_web: row.version_web, fk_idforma_pago_entrega: row.fk_idforma_pago_entrega,
    total: number(row.monto_total), cobrado_antes: number(row.cobrado), saldo,
    monto_delivery: number(row.monto_delivery), delivery_a_pagar: row.delivery_ya_pagado ? 0 : number(row.monto_delivery) };
};

async function formaEfectivo(c) {
  const forma = (await c.query(`SELECT idforma_pago FROM forma_pago WHERE activo AND es_ingreso AND es_egreso
    ORDER BY (lower(nombre)='efectivo') DESC, es_default DESC, orden LIMIT 1`)).rows[0];
  if (!forma || !(await c.query("SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND (lower(nombre)='efectivo' OR es_default)", [forma.idforma_pago])).rowCount) {
    fail('Falta la forma de pago "Efectivo" (activa, para ingresos y egresos)', 500);
  }
  return forma.idforma_pago;
}

// Entregadores con pedidos por rendir (para la pantalla de Pagos a delivery).
export async function resumenRendiciones() {
  const { rows } = await pool.query(`SELECT e.identregador_delivery AS id, e.nombre_completo AS nombre, e.activo, count(*)::int AS pedidos
    FROM (${pendientesDe('p.fk_identregador_delivery IS NOT NULL')}) x JOIN entregador_delivery e ON e.identregador_delivery = x.identregador
    GROUP BY e.identregador_delivery, e.nombre_completo, e.activo ORDER BY e.nombre_completo`);
  return rows;
}

export async function pendientesRendicion(c, entregadorId) {
  const courier = (await c.query('SELECT identregador_delivery AS id, nombre_completo AS nombre, activo FROM entregador_delivery WHERE identregador_delivery=$1', [id(entregadorId)])).rows[0];
  if (!courier) fail('Entregador no encontrado', 404);
  const [pedidos, formas, caja] = await Promise.all([
    c.query(`${pendientesSql} ORDER BY COALESCE(p.fecha_confirmado, p.fecha_creado), p.idpedido LIMIT ${MAX_PEDIDOS}`, [courier.id]),
    c.query('SELECT idforma_pago, nombre, es_default FROM forma_pago WHERE activo AND es_ingreso ORDER BY orden, nombre, idforma_pago'),
    c.query("SELECT 1 FROM caja_gral WHERE estado='abierta'")
  ]);
  let efectivo = null;
  try { efectivo = await formaEfectivo(c); } catch { /* se avisa al confirmar */ }
  return { entregador: courier, pedidos: pedidos.rows.map(shape), formas: formas.rows, fk_idforma_efectivo: efectivo, caja_abierta: caja.rowCount > 0 };
}

// body: { fk_identregador_delivery, neto?, pedidos: [{ idpedido, pagos: [{ fk_idforma_pago, importe }] }] }
export async function rendirDelivery(c, body, user) {
  const entregadorId = id(body?.fk_identregador_delivery);
  const courier = (await c.query('SELECT nombre_completo FROM entregador_delivery WHERE identregador_delivery=$1', [entregadorId])).rows[0];
  if (!courier) fail('Entregador no encontrado', 404);
  if (!Array.isArray(body?.pedidos) || !body.pedidos.length) fail('Elegí al menos un pedido para rendir');
  if (body.pedidos.length > MAX_PEDIDOS) fail(`Se pueden rendir hasta ${MAX_PEDIDOS} pedidos a la vez`);
  const pedidoIds = body.pedidos.map(item => id(item?.idpedido));
  if (new Set(pedidoIds).size !== pedidoIds.length) fail('Hay pedidos repetidos');
  if (!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount) fail('Abrí una caja antes de rendir');
  const efectivoId = await formaEfectivo(c);
  const ingreso = new Map((await c.query('SELECT idforma_pago, nombre FROM forma_pago WHERE activo AND es_ingreso')).rows.map(f => [f.idforma_pago, f.nombre]));

  // Bloquea los pedidos para que dos rendiciones simultáneas no tomen el mismo.
  const locked = (await c.query(`SELECT p.idpedido FROM pedido p WHERE p.idpedido = ANY($1::int[]) ORDER BY p.idpedido FOR UPDATE OF p`, [pedidoIds])).rows;
  if (locked.length !== pedidoIds.length) fail('Algún pedido no existe', 404);
  const current = new Map((await c.query(`${pendientesSql} AND p.idpedido = ANY($2::int[])`, [entregadorId, pedidoIds])).rows.map(row => [row.idpedido, shape(row)]));

  const detalle = [];
  for (const item of body.pedidos) {
    const pedidoId = id(item.idpedido);
    const p = current.get(pedidoId);
    if (!p) fail(`El pedido #${pedidoId} no está pendiente de rendir para ${courier.nombre_completo}. Volvé a cargar`, 409);
    const pagos = Array.isArray(item.pagos) ? item.pagos.filter(pay => Number(pay?.importe) > 0) : [];
    if (pagos.length > 5) fail(`Pedido #${pedidoId}: hasta 5 formas de cobro`);
    for (const pay of pagos) {
      integer(pay.importe, 'Importe', 1);
      if (!ingreso.has(id(pay.fk_idforma_pago))) fail(`Pedido #${pedidoId}: elegí una forma de cobro activa`);
    }
    const cobrado = pagos.reduce((sum, pay) => sum + Number(pay.importe), 0);
    // La rendición cobra el saldo completo: si el cliente no pagó todo, no se rinde ese pedido todavía.
    if (cobrado !== p.saldo) fail(`Pedido #${pedidoId}: el cobro (${cobrado.toLocaleString('es-PY')} Gs.) debe ser igual al saldo (${p.saldo.toLocaleString('es-PY')} Gs.)`);
    // Si el pedido sigue en COCINA se termina; con la cuenta abierta se cobra (y se cierra).
    if (p.estado === 'en_preparacion') await finishOrder(c, pedidoId, null, user);
    if ((await account(c, p.fk_idcuenta)).estado === 'abierta') await collect(c, p.fk_idcuenta, { pagos }, user);
    const efectivo = pagos.filter(pay => id(pay.fk_idforma_pago) === efectivoId).reduce((sum, pay) => sum + Number(pay.importe), 0);
    const formas = [...new Set(pagos.map(pay => ingreso.get(id(pay.fk_idforma_pago))))].join(', ') || null;
    detalle.push({ ...p, cobrado_efectivo: efectivo, cobrado_otros: cobrado - efectivo, formas_cobro: formas });
  }

  const efectivoCobrado = detalle.reduce((sum, row) => sum + row.cobrado_efectivo, 0);
  const otrosCobrado = detalle.reduce((sum, row) => sum + row.cobrado_otros, 0);
  const aPagar = detalle.filter(row => row.delivery_a_pagar > 0);
  const deliveryPagado = aPagar.reduce((sum, row) => sum + row.delivery_a_pagar, 0);
  const neto = efectivoCobrado - deliveryPagado;
  // Lo que vio quien rinde debe coincidir con lo que se registra.
  if (body.neto !== undefined && Number(body.neto) !== neto) fail(`El neto cambió a ${neto.toLocaleString('es-PY')} Gs. Volvé a cargar antes de rendir`, 409);

  let pagoId = null;
  if (deliveryPagado > 0) {
    const fechas = aPagar.map(row => row.fecha.slice(0, 10)).sort();
    pagoId = await registrarPago(c, { entregadorId, entregador: courier.nombre_completo, rows: aPagar.map(row => ({ idpedido: row.idpedido, monto_delivery: row.delivery_a_pagar })),
      inicio: fechas[0], fin: fechas[fechas.length - 1], formaId: efectivoId, tipoId: await tipoGastoDelivery(c), user,
      descripcion: `Rendición de ${courier.nombre_completo} · delivery de ${aPagar.length} pedidos` });
  }
  const rendicion = (await c.query(`INSERT INTO rendicion_delivery(fk_identregador_delivery,cantidad_pedidos,efectivo_cobrado,otros_cobrado,delivery_pagado,neto,fk_idpago_delivery,creado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING idrendicion_delivery`, [entregadorId, detalle.length, efectivoCobrado, otrosCobrado, deliveryPagado, neto, pagoId, user.login])).rows[0];
  for (const row of detalle) {
    await c.query(`INSERT INTO rendicion_delivery_pedido(fk_idrendicion_delivery,fk_idpedido,total_pedido,cobrado_antes,cobrado_efectivo,cobrado_otros,formas_cobro,delivery_pagado)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [rendicion.idrendicion_delivery, row.idpedido, row.total, row.cobrado_antes, row.cobrado_efectivo, row.cobrado_otros, row.formas_cobro, row.delivery_a_pagar]);
  }
  await auditar(c, user, { accion: 'RENDICION_DELIVERY', entidad: 'rendicion_delivery', id: rendicion.idrendicion_delivery,
    despues: { entregador: courier.nombre_completo, pedidos: detalle.length, efectivo: efectivoCobrado, otros: otrosCobrado, delivery: deliveryPagado, neto } });
  return { rendicion: await rendicionDelivery(c, rendicion.idrendicion_delivery) };
}

// Anula la rendición y el pago de su delivery (la plata vuelve a la caja). Los cobros a los clientes se mantienen:
// los pedidos vuelven a quedar pendientes con el delivery sin pagar y se pueden rendir de nuevo.
export async function anularRendicion(c, rendicionId, body, user) {
  const motivo = textRequired(body?.motivo, 'El motivo');
  if (motivo.length > 500) fail('El motivo admite hasta 500 caracteres');
  const r = (await c.query('SELECT * FROM rendicion_delivery WHERE idrendicion_delivery=$1 FOR UPDATE', [id(rendicionId)])).rows[0];
  if (!r) fail('Rendición no encontrada', 404);
  if (r.estado === 'anulada') fail('La rendición ya fue anulada', 409);
  if (r.fk_idpago_delivery) await anularPagoDelivery(c, r.fk_idpago_delivery, { motivo: `Rendición #${r.idrendicion_delivery} anulada: ${motivo}`.slice(0, 500) }, user, { desdeRendicion: true });
  await c.query("UPDATE rendicion_delivery SET estado='anulada',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado=$2 WHERE idrendicion_delivery=$3", [user.login, motivo, r.idrendicion_delivery]);
  await c.query('UPDATE rendicion_delivery_pedido SET activo=false WHERE fk_idrendicion_delivery=$1', [r.idrendicion_delivery]);
  await auditar(c, user, { accion: 'RENDICION_DELIVERY_ANULADA', entidad: 'rendicion_delivery', id: r.idrendicion_delivery, motivo,
    antes: { estado: 'activa', neto: number(r.neto), delivery: number(r.delivery_pagado) }, despues: { estado: 'anulada' } });
  return { rendicion: await rendicionDelivery(c, r.idrendicion_delivery) };
}

export async function rendicionDelivery(c, rendicionId) {
  const r = (await c.query(`SELECT r.*, e.nombre_completo AS entregador, e.telefono AS entregador_telefono
    FROM rendicion_delivery r JOIN entregador_delivery e ON e.identregador_delivery=r.fk_identregador_delivery
    WHERE r.idrendicion_delivery=$1`, [id(rendicionId)])).rows[0];
  if (!r) fail('Rendición no encontrada', 404);
  for (const key of ['efectivo_cobrado', 'otros_cobrado', 'delivery_pagado', 'neto']) r[key] = number(r[key]);
  r.pedidos = (await c.query(`SELECT rp.fk_idpedido AS idpedido, rp.total_pedido, rp.cobrado_antes, rp.cobrado_efectivo, rp.cobrado_otros, rp.formas_cobro, rp.delivery_pagado,
      cl.nombre_completo AS cliente, p.zona_nombre
    FROM rendicion_delivery_pedido rp JOIN pedido p ON p.idpedido=rp.fk_idpedido JOIN cliente cl ON cl.idcliente=p.fk_idcliente
    WHERE rp.fk_idrendicion_delivery=$1 ORDER BY rp.fk_idpedido`, [r.idrendicion_delivery])).rows
    .map(row => ({ ...row, ...Object.fromEntries(['total_pedido', 'cobrado_antes', 'cobrado_efectivo', 'cobrado_otros', 'delivery_pagado'].map(key => [key, number(row[key])])) }));
  return r;
}

export async function listaRendiciones(inicio, fin, entregador = null) {
  const { rows } = await pool.query(`SELECT r.idrendicion_delivery, to_char(r.fecha_creado,'YYYY-MM-DD HH24:MI') AS fecha, r.creado_por,
      r.fk_identregador_delivery AS identregador, e.nombre_completo AS entregador, r.cantidad_pedidos,
      r.efectivo_cobrado, r.otros_cobrado, r.delivery_pagado, r.neto, r.estado, r.motivo_anulado
    FROM rendicion_delivery r JOIN entregador_delivery e ON e.identregador_delivery=r.fk_identregador_delivery
    WHERE r.fecha_creado >= $1::date AND r.fecha_creado < ($2::date + INTERVAL '1 day') AND ($3::int IS NULL OR r.fk_identregador_delivery=$3)
    ORDER BY r.fecha_creado DESC, r.idrendicion_delivery DESC`, [inicio, fin, entregador]);
  return rows.map(row => ({ ...row, ...Object.fromEntries(['efectivo_cobrado', 'otros_cobrado', 'delivery_pagado', 'neto'].map(key => [key, number(row[key])])) }));
}
