import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, integer, id, fail } from '../services/pedidos.js';
import { renderCajaTicket } from '../services/caja-ticket.js';

const router = Router();
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
    COALESCE((SELECT sum(a.monto_inicial) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral),0) AS monto_inicial,
    COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS total_ingresos,
    COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='egreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE 0 END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS total_egresos,
    COALESCE((SELECT sum(a.monto_inicial) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral),0)
      + COALESCE((SELECT sum(CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale ELSE -(i.monto_pago+i.monto_compra+i.monto_gasto+i.monto_vale) END) FROM caja_item i WHERE i.fk_idcaja_gral=cg.idcaja_gral),0) AS monto_esperado,
    (SELECT sum(a.monto_contado) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral) AS monto_contado,
    (SELECT sum(a.diferencia) FROM caja_arqueo a WHERE a.fk_idcaja_gral=cg.idcaja_gral) AS diferencia
  FROM caja_gral cg`;

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
  const [open, closed, count] = await Promise.all([
    pool.query(`${summarySql} WHERE cg.estado='abierta'`),
    pool.query(`${summarySql} WHERE cg.estado='cerrada' ORDER BY cg.idcaja_gral DESC LIMIT $1 OFFSET $2`, [pageSize, (page - 1) * pageSize]),
    pool.query("SELECT count(*)::int AS total FROM caja_gral WHERE estado='cerrada'")
  ]);
  const total = count.rows[0].total;
  return { abierta: open.rows[0] || null, cerradas: closed.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
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
  return { caja, efectivo: await activeCash(), pendientes: caja.estado === 'abierta' ? await pendingPayments(pool) : [], arqueos: arqueos.rows, movimientos: movimientos.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));

router.post('/:id/cerrar', formAccess, route((req) => operation(req, async (client) => {
  const cajaId = id(req.params.id);
  const conteos = req.body?.conteos;
  if (!conteos || typeof conteos !== 'object' || Array.isArray(conteos)) fail('Ingresá el monto contado en efectivo');
  for (const [forma, monto] of Object.entries(conteos)) { id(forma); integer(monto, 'Monto contado'); }
  const pendientes = await pendingPayments(client);
  if (pendientes.length) {
    const lista = pendientes.map((row) => `${row.mesa_numero ? `Mesa ${row.mesa_numero}` : row.tipo} (pedido ${row.pedidos.map((n) => `#${n}`).join(', ')})`).join('; ');
    fail(`No se puede cerrar la caja: hay ${pendientes.length === 1 ? 'una cuenta' : `${pendientes.length} cuentas`} con pedidos pendientes de pago: ${lista}`, 409);
  }
  // Solo el efectivo se cuenta a mano; las demás formas se cierran por el monto esperado salvo que se envíe otro.
  const efectivo = await activeCash(client);
  if (conteos[efectivo.idforma_pago] === undefined || conteos[efectivo.idforma_pago] === '') fail('Ingresá el monto contado en efectivo');
  const completos = { ...conteos };
  for (const row of await arqueoRows(client, cajaId)) {
    const key = String(row.fk_idforma_pago);
    if (completos[key] === undefined) completos[key] = Math.max(0, Number(row.monto_esperado));
  }
  await client.query('SELECT cerrar_caja_gral($1,$2::jsonb,$3)', [cajaId, JSON.stringify(completos), req.user.login]);
  return { idcaja_gral: cajaId, estado: 'cerrada' };
})));

const originLabels = { cobro: 'Cobros de pedidos', devolucion: 'Devoluciones', pago_compra: 'Pagos de compras', compra: 'Compras', gasto: 'Gastos', vale: 'Vales' };

async function cajaTicketData(cajaId) {
  const caja = (await pool.query(`${summarySql} WHERE cg.idcaja_gral=$1 AND cg.estado='cerrada'`, [cajaId])).rows[0];
  if (!caja) return null;
  const period = [caja.fecha_apertura, caja.fecha_cierre];
  const [arqueos, movimientos, categorias, productos, anulados] = await Promise.all([
    arqueoRows(pool, cajaId),
    pool.query(`
      SELECT i.tipo_movimiento, i.es_reversion,
        CASE WHEN i.fk_iddevolucion_pago IS NOT NULL THEN 'devolucion'
             WHEN i.fk_idpago IS NOT NULL THEN 'cobro'
             WHEN i.fk_idcompra_pago IS NOT NULL THEN 'pago_compra'
             WHEN i.fk_idcompra IS NOT NULL THEN 'compra'
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
      WHERE p.estado='cancelado' AND p.fecha_anulado>=$1 AND p.fecha_anulado<=$2 ORDER BY p.fecha_anulado, p.idpedido`, period)
  ]);
  const group = (tipo) => movimientos.rows.filter((row) => row.tipo_movimiento === tipo)
    .map((row) => ({ etiqueta: `${originLabels[row.origen] || 'Otros'}${row.es_reversion ? ' (reversión)' : ''}`, cantidad: row.cantidad, monto: row.monto }));
  const efectivo = await activeCash();
  return { caja, efectivoId: efectivo.idforma_pago, efectivoNombre: efectivo.nombre, arqueos, ingresos: group('ingreso'), egresos: group('egreso'), categorias: categorias.rows, productos: productos.rows, anulados: anulados.rows };
}

router.get('/:id/ticket.pdf', formAccess, async (req, res, next) => {
  try {
    const cajaId = id(req.params.id);
    const data = await cajaTicketData(cajaId);
    if (!data) return res.status(404).json({ error: 'Caja cerrada no encontrada' });
    const pdf = await renderCajaTicket(data);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cierre-caja-${cajaId}.pdf"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(pdf.length)
    });
    res.send(pdf);
  } catch (error) { next(error); }
});

export default router;
