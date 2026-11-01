import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, integer, id, fail } from '../services/pedidos.js';

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
  const result = await client.query("SELECT idforma_pago,nombre FROM forma_pago WHERE activo AND upper(btrim(nombre))='EFECTIVO' ORDER BY idforma_pago");
  if (result.rowCount !== 1) fail('Debe existir una única forma de pago activa llamada EFECTIVO');
  return result.rows[0];
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
  const arqueos = await pool.query(`
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
  return { caja, arqueos: arqueos.rows, movimientos: movimientos.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}));

router.post('/:id/cerrar', formAccess, route((req) => operation(req, async (client) => {
  const cajaId = id(req.params.id);
  const conteos = req.body?.conteos;
  if (!conteos || typeof conteos !== 'object' || Array.isArray(conteos)) fail('Ingresá los montos contados');
  for (const [forma, monto] of Object.entries(conteos)) { id(forma); integer(monto, 'Monto contado'); }
  await client.query('SELECT cerrar_caja_gral($1,$2::jsonb,$3)', [cajaId, JSON.stringify(conteos), req.user.login]);
  return { idcaja_gral: cajaId, estado: 'cerrada' };
})));

export default router;
