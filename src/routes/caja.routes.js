import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, integer, id, fail } from '../services/pedidos.js';
import { renderCajaTicket } from '../services/caja-ticket.js';
import { sendPdf, ticketRoute } from '../services/ticket-pdf.js';
import { auditar } from '../services/auditoria.js';
import { deliveryPendienteDeCaja } from '../services/pagos-delivery.js';
import { resumenPorUsuario } from '../services/caja-usuarios.js';

const router = Router();
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const formAccess = requireCurrentForm;
const route = (fn) => async (req, res, next) => {
  try { res.json(await fn(req)); }
  catch (error) {
    if (error.code === 'P0001' || error.code === '23514' || error.code === '23503') error.status = 400;
    if (error.code === '23505') error.status = 409;
    next(error);
  }
};

router.use(requireAuth);

const summarySql = `
  SELECT cg.idcaja_gral, cg.fecha_apertura, cg.fecha_cierre, cg.creado_por, cg.cerrado_por, cg.estado,
    cg.cierre_billetes, cg.cierre_monedas, cg.cierre_pos, cg.cierre_egresos, cg.cierre_vendido, cg.cierre_delivery, cg.cierre_diferencia,
    COALESCE((SELECT sum(a.monto_inicial) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral),0) AS monto_inicial,
    COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS total_ingresos,
    COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='egreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS total_egresos,
    COALESCE((SELECT sum(a.monto_inicial) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral),0)
      + COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE -(i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale) END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS monto_esperado,
    (SELECT sum(a.monto_contado) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral) AS monto_contado,
    (SELECT sum(a.diferencia) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral) AS diferencia,
    -- Pedidos no anulados creados mientras la caja estuvo abierta: total sin delivery y delivery aparte.
    pc.total_pedidos_sin_delivery, pc.total_delivery, pc.cantidad_pedidos
  FROM caja_gral cg
  CROSS JOIN LATERAL (SELECT COALESCE(sum(p.monto_total-p.monto_delivery),0) AS total_pedidos_sin_delivery,
      COALESCE(sum(p.monto_delivery),0) AS total_delivery, count(*)::int AS cantidad_pedidos
    FROM pedido p WHERE p.estado<>'cancelado' AND p.fecha_creado>=cg.fecha_apertura
      AND (cg.fecha_cierre IS NULL OR p.fecha_creado<cg.fecha_cierre)) pc`;

async function activeCash(client = pool) {
  // Forma de pago por defecto (configurable en Formas de pago): en ella se registran el saldo inicial y el arqueo.
  const result = await client.query('SELECT idforma_pago,nombre FROM forma_pago WHERE activo AND es_default');
  if (result.rowCount !== 1) fail('Definí una forma de pago activa por defecto en Formas de pago');
  return result.rows[0];
}

async function arqueoRows(client, cajaId) {
  const result = await client.query(`
    SELECT a.idcaja_arqueo, a.fk_idforma_pago, f.nombre AS forma_pago, a.monto_inicial,
      COALESCE(sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END),0) AS total_ingresos,
      COALESCE(sum(CASE WHEN i.tipo_movimiento='egreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END),0) AS total_egresos,
      a.monto_inicial + COALESCE(sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE -(i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale) END),0) AS monto_esperado,
      a.monto_contado, a.diferencia
    FROM caja_arqueo a JOIN forma_pago f ON f.idforma_pago=a.fk_idforma_pago
    LEFT JOIN caja_item i ON i.fk_idcaja_gral=a.fk_idcaja_gral AND i.fk_idforma_pago=a.fk_idforma_pago
    WHERE a.fk_idcaja_gral=$1
    GROUP BY a.idcaja_arqueo,f.nombre,f.orden
    HAVING a.monto_inicial <> 0 OR count(i.idcaja_item) > 0 OR a.monto_contado IS NOT NULL
    ORDER BY f.orden,f.nombre`, [cajaId]);
  return result.rows;
}

// Arqueo del cierre: se cuenta la plata real porque casi todo se cobra como efectivo.
// Diferencia = (billetes + monedas − saldo inicial + egresos en efectivo) + POS − total vendido con delivery.
// Egresos: lo que salió del cajón (gastos, vales, compras y pagos a delivery), netos de sus reversiones;
// las devoluciones no van porque el pedido anulado ya no suma en lo vendido.
export const DENOMINACIONES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];
const egresoLabels = { gasto: 'Gastos', vale: 'Vales', compra: 'Compras', pago_compra: 'Pagos de compras', delivery: 'Pagos a delivery' };

export async function datosArqueo(client, cajaId) {
  const caja = (await client.query(`${summarySql} WHERE cg.idcaja_gral=$1`, [cajaId])).rows[0];
  if (!caja) fail('Caja no encontrada', 404);
  const efectivo = await activeCash(client);
  const hasta = caja.fecha_cierre || new Date();
  // En serie: el cliente puede ser el de una transacción, que no admite consultas en paralelo.
  const egresos = await client.query(`
      SELECT x.origen, sum(CASE WHEN x.tipo_movimiento='egreso' THEN x.monto ELSE -x.monto END) AS monto,
        count(*) FILTER (WHERE NOT x.es_reversion)::int AS cantidad
      FROM (SELECT i.tipo_movimiento, i.es_reversion, i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale AS monto,
          CASE WHEN i.fk_idcompra_pago IS NOT NULL THEN 'pago_compra'
               WHEN i.fk_idcompra IS NOT NULL THEN 'compra'
               WHEN i.fk_idgasto IS NOT NULL AND EXISTS (SELECT 1 FROM pago_delivery pd WHERE pd.fk_idgasto=i.fk_idgasto) THEN 'delivery'
               WHEN i.fk_idgasto IS NOT NULL THEN 'gasto'
               WHEN i.fk_idvale IS NOT NULL THEN 'vale' END AS origen
        FROM caja_item i WHERE i.fk_idcaja_gral=$1 AND i.fk_idforma_pago=$2) x
      WHERE x.origen IS NOT NULL GROUP BY x.origen`, [cajaId, efectivo.idforma_pago]);
  // Máquinas activas (y las usadas en el cierre aunque hoy estén inactivas), con lo rendido por delivery en esta caja.
  const maquinas = await client.query(`
      SELECT m.idmaquina_pos, m.nombre, m.numero, c.monto AS contado,
        COALESCE((SELECT sum(r.pos_informado) FROM rendicion_delivery r WHERE r.estado='activa' AND r.fk_idmaquina_pos=m.idmaquina_pos
          AND r.fecha_creado>=$2 AND r.fecha_creado<=$3),0) AS rendido
      FROM maquina_pos m LEFT JOIN caja_cierre_pos c ON c.fk_idmaquina_pos=m.idmaquina_pos AND c.fk_idcaja_gral=$1
      WHERE m.activo OR c.monto IS NOT NULL ORDER BY m.orden, m.nombre, m.idmaquina_pos`, [cajaId, caja.fecha_apertura, hasta]);
  const billetes = await client.query('SELECT denominacion, cantidad FROM caja_cierre_billete WHERE fk_idcaja_gral=$1 ORDER BY denominacion DESC', [cajaId]);
  const detalleEgresos = Object.keys(egresoLabels).map(origen => {
    const row = egresos.rows.find(r => r.origen === origen);
    return { origen, etiqueta: egresoLabels[origen], cantidad: row?.cantidad || 0, monto: Number(row?.monto || 0) };
  }).filter(row => row.monto || row.cantidad);
  const sinDelivery = Number(caja.total_pedidos_sin_delivery), delivery = Number(caja.total_delivery);
  return {
    efectivo, saldo_inicial: Number(caja.monto_inicial), denominaciones: DENOMINACIONES,
    billetes: billetes.rows.map(r => ({ denominacion: r.denominacion, cantidad: r.cantidad })),
    egresos: detalleEgresos, total_egresos: detalleEgresos.reduce((sum, row) => sum + row.monto, 0),
    vendido_sin_delivery: sinDelivery, delivery, vendido: sinDelivery + delivery,
    maquinas_pos: maquinas.rows.map(r => ({ idmaquina_pos: r.idmaquina_pos, nombre: r.nombre, numero: r.numero,
      rendido: Number(r.rendido), contado: r.contado === null ? null : Number(r.contado) }))
  };
}

// Cuentas abiertas con pedidos vigentes y saldo por cobrar: impiden cerrar la caja.
async function pendingPayments(client) {
  const result = await client.query(`
    SELECT c.idcuenta, c.tipo, m.numero AS mesa_numero, c.total - cobrado_neto_cuenta(c.idcuenta) AS saldo,
      array_agg(p.idpedido ORDER BY p.idpedido) AS pedidos
    FROM cuenta c JOIN pedido p ON p.fk_idcuenta = c.idcuenta AND p.estado <> 'cancelado'
    LEFT JOIN mesa m ON m.idmesa = c.fk_idmesa
    WHERE c.estado = 'abierta'
    GROUP BY c.idcuenta, c.tipo, m.numero, c.total
    HAVING c.total - cobrado_neto_cuenta(c.idcuenta) > 0
    ORDER BY c.idcuenta`);
  return result.rows;
}

router.get('/estado', route(async () => ({
  caja: (await pool.query(`${summarySql} WHERE cg.estado='abierta'`)).rows[0] || null,
  efectivo: await activeCash()
})));

router.post('/abrir', route((req) => operation(req, async (client) => {
  const monto = integer(req.body?.monto_inicial ?? '', 'Monto inicial');
  const efectivo = await activeCash(client);
  const saldos = { [efectivo.idforma_pago]: monto };
  const result = await client.query('SELECT abrir_caja_gral($1::jsonb,$2) AS id', [JSON.stringify(saldos), req.user.login]);
  return { idcaja_gral: result.rows[0].id };
})));

router.get('/', formAccess, route(async (req) => {
  const page = integer(req.query.page || 1, 'Página', 1);
  const pageSize = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const { inicio, fin } = req.query;
  if ((inicio && !validDate(inicio)) || (fin && !validDate(fin)) || (inicio && fin && inicio > fin)) fail('Rango de fechas inválido');
  // Filtra las cajas cerradas por fecha de apertura; la caja abierta se muestra siempre.
  const range = `cg.estado='cerrada' AND ($1::date IS NULL OR cg.fecha_apertura >= $1::date) AND ($2::date IS NULL OR cg.fecha_apertura < $2::date + INTERVAL '1 day')`;
  const dates = [inicio || null, fin || null];
  const [open, closed, count] = await Promise.all([
    pool.query(`${summarySql} WHERE cg.estado='abierta'`),
    pool.query(`${summarySql} WHERE ${range} ORDER BY cg.idcaja_gral DESC LIMIT $3 OFFSET $4`, [...dates, pageSize, (page - 1) * pageSize]),
    pool.query(`SELECT count(*)::int AS total FROM caja_gral cg WHERE ${range}`, dates)
  ]);
  const total = count.rows[0].total;
  // Delivery ya cobrado que todavía no se pagó al entregador: está en caja pero no es del local.
  return { abierta: open.rows[0] || null, delivery_pendiente: open.rows[0] ? await deliveryPendienteDeCaja() : null,
    por_usuario: open.rows[0] ? await resumenPorUsuario(pool, open.rows[0].idcaja_gral) : null, cerradas: closed.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));

router.get('/:id', formAccess, route(async (req) => {
  const cajaId = id(req.params.id);
  const page = integer(req.query.page || 1, 'Página', 1);
  const pageSize = [25, 50, 100].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 25;
  const caja = (await pool.query(`${summarySql} WHERE cg.idcaja_gral=$1`, [cajaId])).rows[0];
  if (!caja) fail('Caja no encontrada', 404);
  const arqueos = { rows: await arqueoRows(pool, cajaId) };
  const total = (await pool.query('SELECT count(*)::int AS total FROM caja_item WHERE fk_idcaja_gral=$1', [cajaId])).rows[0].total;
  const movimientos = await pool.query(`
    SELECT i.idcaja_item, i.fecha_creado, i.tipo_movimiento, i.descripcion,
      i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale AS monto,
      f.nombre AS forma_pago, i.es_reversion,
      CASE WHEN i.fk_iddevolucion_pago IS NOT NULL THEN 'devolucion'
           WHEN i.fk_idpago IS NOT NULL THEN 'cobro'
           WHEN i.fk_idcompra_pago IS NOT NULL THEN 'pago_compra'
           WHEN i.fk_idcompra IS NOT NULL THEN 'compra'
           WHEN i.fk_idgasto IS NOT NULL THEN 'gasto'
           WHEN i.fk_idvale IS NOT NULL THEN 'vale' END AS origen,
      COALESCE(i.fk_iddevolucion_pago,i.fk_idpago,i.fk_idcompra_pago,i.fk_idcompra,i.fk_idgasto,i.fk_idvale) AS origen_id,
      CASE WHEN i.fk_iddevolucion_pago IS NOT NULL THEN 'aprobada'
           WHEN i.fk_idpago IS NOT NULL THEN p.estado::text
           WHEN i.fk_idcompra_pago IS NOT NULL THEN cp.estado
           WHEN i.fk_idcompra IS NOT NULL THEN co.estado_pago::text
           WHEN i.fk_idgasto IS NOT NULL THEN g.estado::text
           WHEN i.fk_idvale IS NOT NULL THEN v.estado::text END AS estado_origen
    FROM caja_item i JOIN forma_pago f ON f.idforma_pago=i.fk_idforma_pago
    LEFT JOIN pago p ON p.idpago=i.fk_idpago
    LEFT JOIN compra co ON co.idcompra=i.fk_idcompra
    LEFT JOIN compra_pago cp ON cp.idcompra_pago=i.fk_idcompra_pago
    LEFT JOIN gasto g ON g.idgasto=i.fk_idgasto
    LEFT JOIN vale v ON v.idvale=i.fk_idvale
    WHERE i.fk_idcaja_gral=$1 ORDER BY i.idcaja_item DESC LIMIT $2 OFFSET $3`, [cajaId, pageSize, (page - 1) * pageSize]);
  return { caja, efectivo: await activeCash(), arqueo: await datosArqueo(pool, cajaId), pendientes: caja.estado === 'abierta' ? await pendingPayments(pool) : [],
    delivery_pendiente: caja.estado === 'abierta' ? await deliveryPendienteDeCaja() : null, arqueos: arqueos.rows, movimientos: movimientos.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));

router.post('/:id/cerrar', formAccess, route((req) => operation(req, async (client) => {
  const cajaId = id(req.params.id);
  const body = req.body || {};
  const objeto = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  const billetesBody = objeto(body.billetes), posBody = objeto(body.pos) || {};
  if (!billetesBody) fail('Ingresá la cantidad de cada billete');
  const vacio = value => value === undefined || value === null || value === '' ? 0 : value;
  const billetes = DENOMINACIONES.map(denominacion => ({ denominacion,
    cantidad: integer(vacio(billetesBody[denominacion]), `Billetes de ${denominacion.toLocaleString('es-PY')}`) }));
  const monedas = integer(vacio(body.monedas), 'Monedas');
  const pendientes = await pendingPayments(client);
  if (pendientes.length) {
    const lista = pendientes.map((row) => `${row.mesa_numero ? `Mesa ${row.mesa_numero}` : row.tipo} (pedido ${row.pedidos.map((n) => `#${n}`).join(', ')})`).join('; ');
    fail(`No se puede cerrar la caja: hay ${pendientes.length === 1 ? 'una cuenta' : `${pendientes.length} cuentas`} con pedidos pendientes de pago: ${lista}`, 409);
  }
  const arqueo = await datosArqueo(client, cajaId);
  const maquinas = new Map(arqueo.maquinas_pos.map(m => [m.idmaquina_pos, m]));
  const pos = [];
  for (const [maquinaId, monto] of Object.entries(posBody)) {
    const maquina = maquinas.get(id(maquinaId));
    if (!maquina) fail('Elegí una máquina POS activa');
    const valor = integer(vacio(monto), `Monto del POS ${maquina.nombre}`);
    if (valor) pos.push({ maquinaId: maquina.idmaquina_pos, monto: valor });
  }
  const totalBilletes = billetes.reduce((sum, b) => sum + b.denominacion * b.cantidad, 0);
  const totalPos = pos.reduce((sum, p) => sum + p.monto, 0);
  const diferencia = totalBilletes + monedas - arqueo.saldo_inicial + arqueo.total_egresos + totalPos - arqueo.vendido;
  // Billetes + monedas cierran también el arqueo por forma de pago del efectivo; las demás formas, por su esperado.
  const completos = { [arqueo.efectivo.idforma_pago]: totalBilletes + monedas };
  for (const row of await arqueoRows(client, cajaId)) {
    const key = String(row.fk_idforma_pago);
    if (completos[key] === undefined) completos[key] = Math.max(0, Number(row.monto_esperado));
  }
  await client.query('SELECT cerrar_caja_gral($1,$2::jsonb,$3)', [cajaId, JSON.stringify(completos), req.user.login]);
  for (const b of billetes) if (b.cantidad) await client.query('INSERT INTO caja_cierre_billete(fk_idcaja_gral,denominacion,cantidad) VALUES($1,$2,$3)', [cajaId, b.denominacion, b.cantidad]);
  for (const p of pos) await client.query('INSERT INTO caja_cierre_pos(fk_idcaja_gral,fk_idmaquina_pos,monto) VALUES($1,$2,$3)', [cajaId, p.maquinaId, p.monto]);
  await client.query(`UPDATE caja_gral SET cierre_billetes=$2, cierre_monedas=$3, cierre_pos=$4, cierre_egresos=$5, cierre_vendido=$6, cierre_delivery=$7, cierre_diferencia=$8
    WHERE idcaja_gral=$1`, [cajaId, totalBilletes, monedas, totalPos, arqueo.total_egresos, arqueo.vendido, arqueo.delivery, diferencia]);
  if (diferencia) await auditar(client, req.user, { accion: 'CAJA_CIERRE_DIFERENCIA', entidad: 'caja', id: cajaId,
    antes: { vendido: arqueo.vendido, saldo_inicial: arqueo.saldo_inicial, egresos: arqueo.total_egresos },
    despues: { billetes: totalBilletes, monedas, pos: totalPos, diferencia } });
  return { idcaja_gral: cajaId, estado: 'cerrada', diferencia };
})));

const originLabels = { cobro: 'Cobros de pedidos', devolucion: 'Devoluciones', pago_compra: 'Pagos de compras', compra: 'Compras', gasto: 'Gastos', vale: 'Vales', delivery: 'Pagos a delivery' };
const num = value => Number(value || 0);

export async function cajaTicketData(cajaId) {
  const caja = (await pool.query(`${summarySql} WHERE cg.idcaja_gral=$1 AND cg.estado='cerrada'`, [cajaId])).rows[0];
  if (!caja) return null;
  const period = [caja.fecha_apertura, caja.fecha_cierre];
  const [arqueos, movimientos, categorias, productos, anulados, usuarios, descuentos, pos, rendiciones, insumos] = await Promise.all([
    arqueoRows(pool, cajaId),
    pool.query(`
      SELECT i.tipo_movimiento, i.es_reversion,
        CASE WHEN i.fk_iddevolucion_pago IS NOT NULL THEN 'devolucion'
             WHEN i.fk_idpago IS NOT NULL THEN 'cobro'
             WHEN i.fk_idcompra_pago IS NOT NULL THEN 'pago_compra'
             WHEN i.fk_idcompra IS NOT NULL THEN 'compra'
             WHEN i.fk_idgasto IS NOT NULL AND EXISTS (SELECT 1 FROM pago_delivery pd WHERE pd.fk_idgasto=i.fk_idgasto) THEN 'delivery'
             WHEN i.fk_idgasto IS NOT NULL THEN 'gasto'
             WHEN i.fk_idvale IS NOT NULL THEN 'vale' END AS origen,
        count(*)::int AS cantidad, sum(i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale) AS monto
      FROM caja_item i WHERE i.fk_idcaja_gral=$1
      GROUP BY 1, 2, 3 ORDER BY 1, 3, 2`, [cajaId]),
    pool.query(`
      SELECT c.nombre, sum(d.cantidad)::int AS cantidad, sum(d.cantidad*d.precio_venta) AS importe
      FROM detalle_pedido d JOIN pedido p ON p.idpedido=d.fk_idpedido
      JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
      JOIN categoria_menu c ON c.idcategoria_menu=pm.fk_idcategoria_menu
      WHERE p.estado<>'cancelado' AND d.estado<>'cancelado' AND p.fecha_creado>=$1 AND p.fecha_creado<=$2
      GROUP BY c.idcategoria_menu, c.nombre ORDER BY importe DESC, c.nombre LIMIT 5`, period),
    pool.query(`
      SELECT c.nombre || ' - ' || pm.nombre AS nombre, sum(d.cantidad)::int AS cantidad, sum(d.cantidad*d.precio_venta) AS importe
      FROM detalle_pedido d JOIN pedido p ON p.idpedido=d.fk_idpedido
      JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
      JOIN categoria_menu c ON c.idcategoria_menu=pm.fk_idcategoria_menu
      WHERE p.estado<>'cancelado' AND d.estado<>'cancelado' AND p.fecha_creado>=$1 AND p.fecha_creado<=$2
      GROUP BY pm.idproducto_menu, pm.nombre, c.nombre ORDER BY cantidad DESC, importe DESC, nombre LIMIT 5`, period),
    pool.query(`
      SELECT p.idpedido, p.fecha_anulado, p.monto_total, p.motivo_anulado, p.anulado_por, p.tipo_entrega, m.numero AS mesa_numero
      FROM pedido p LEFT JOIN mesa m ON m.idmesa=p.fk_idmesa
      WHERE p.estado='cancelado' AND p.fecha_anulado>=$1 AND p.fecha_anulado<=$2 ORDER BY p.fecha_anulado, p.idpedido`, period),
    resumenPorUsuario(pool, cajaId),
    // Descuentos de las cuentas cobradas en esta caja: los de cada pedido y los de la cuenta entera.
    pool.query(`
      WITH cuentas AS (SELECT DISTINCT pg.fk_idcuenta AS id FROM caja_item i JOIN pago pg ON pg.idpago=i.fk_idpago WHERE i.fk_idcaja_gral=$1)
      SELECT COALESCE((SELECT sum(p.monto_descuento) FROM pedido p WHERE p.fk_idcuenta IN (SELECT id FROM cuentas) AND p.estado<>'cancelado'),0)
           + COALESCE((SELECT sum(c.monto_descuento) FROM cuenta c WHERE c.idcuenta IN (SELECT id FROM cuentas)),0) AS total,
        (SELECT count(*) FROM pedido p WHERE p.fk_idcuenta IN (SELECT id FROM cuentas) AND p.estado<>'cancelado' AND p.monto_descuento>0)
           + (SELECT count(*) FROM cuenta c WHERE c.idcuenta IN (SELECT id FROM cuentas) AND c.monto_descuento>0) AS cantidad`, [cajaId]),
    // POS rendido por máquina en las rendiciones de delivery hechas con la caja abierta.
    pool.query(`
      SELECT m.nombre, sum(r.pos_informado) AS informado, sum(r.pos_sistema) AS sistema, count(*)::int AS rendiciones
      FROM rendicion_delivery r JOIN maquina_pos m ON m.idmaquina_pos=r.fk_idmaquina_pos
      WHERE r.estado='activa' AND r.fecha_creado>=$1 AND r.fecha_creado<=$2
      GROUP BY m.idmaquina_pos, m.nombre, m.orden ORDER BY m.orden, m.nombre`, period),
    // Rendiciones de delivery: ganancia de los entregadores y efectivo que entregaron o se les pagó.
    pool.query(`
      SELECT count(*)::int AS cantidad, COALESCE(sum(delivery_pagado),0) AS delivery,
        COALESCE(sum(CASE WHEN neto>0 THEN neto ELSE 0 END),0) AS entregado,
        COALESCE(sum(CASE WHEN neto<0 THEN -neto ELSE 0 END),0) AS pagado_local
      FROM rendicion_delivery WHERE estado='activa' AND fecha_creado>=$1 AND fecha_creado<=$2`, period),
    // Insumos usados: cantidad vendida × cantidad del insumo en cada producto.
    pool.query(`
      SELECT i.nombre, u.codigo AS unidad, sum(d.cantidad * pi.cantidad) AS cantidad
      FROM detalle_pedido d JOIN pedido p ON p.idpedido=d.fk_idpedido
      JOIN producto_menu_insumo pi ON pi.fk_idproducto_menu=d.fk_idproducto_menu
      JOIN insumo i ON i.idinsumo=pi.fk_idinsumo JOIN unidad_medida u ON u.idunidad_medida=i.fk_idunidad_medida
      WHERE p.estado<>'cancelado' AND d.estado<>'cancelado' AND p.fecha_creado>=$1 AND p.fecha_creado<=$2
      GROUP BY i.idinsumo, i.nombre, u.codigo ORDER BY i.nombre`, period)
  ]);
  const group = (tipo) => movimientos.rows.filter((row) => row.tipo_movimiento === tipo)
    .map((row) => ({ origen: row.origen, etiqueta: `${originLabels[row.origen] || 'Otros'}${row.es_reversion ? ' (reversión)' : ''}`, cantidad: row.cantidad, monto: row.monto }));
  // Pagos a delivery que salieron de esta caja, netos de anulaciones (incluye los de las rendiciones).
  const deliveryCaja = movimientos.rows.filter(row => row.origen === 'delivery')
    .reduce((sum, row) => sum + (row.tipo_movimiento === 'egreso' ? num(row.monto) : -num(row.monto)), 0);
  const r = rendiciones.rows[0];
  const efectivo = await activeCash();
  return { caja, efectivoId: efectivo.idforma_pago, efectivoNombre: efectivo.nombre, arqueos, arqueo: await datosArqueo(pool, cajaId), ingresos: group('ingreso'), egresos: group('egreso'),
    categorias: categorias.rows, productos: productos.rows, anulados: anulados.rows, usuarios,
    descuentos: { total: num(descuentos.rows[0].total), cantidad: num(descuentos.rows[0].cantidad) },
    pos: pos.rows.map(row => ({ nombre: row.nombre, informado: num(row.informado), sistema: num(row.sistema), rendiciones: row.rendiciones })),
    delivery: { rendiciones: r.cantidad, ganancia: num(r.delivery), entregado: num(r.entregado), pagado_local: num(r.pagado_local),
      // Pagos a delivery fuera de rendición: lo que salió de la caja menos lo ya contado en las rendiciones.
      pagos_aparte: Math.max(0, deliveryCaja - num(r.delivery)) },
    insumos: insumos.rows.map(row => ({ nombre: row.nombre, unidad: row.unidad, cantidad: Number(row.cantidad) })) };
}

ticketRoute(router,'/:id/ticket.pdf', formAccess, async (req, res, next) => {
  try {
    const cajaId = id(req.params.id);
    const data = await cajaTicketData(cajaId);
    if (!data) return res.status(404).json({ error: 'Caja cerrada no encontrada' });
    const pdf = await renderCajaTicket(data);
    await sendPdf(res, pdf, `cierre-caja-${cajaId}.pdf`);
  } catch (error) { next(error); }
});

export default router;
