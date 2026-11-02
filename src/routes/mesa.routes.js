import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm, requirePermission } from '../middleware/auth.js';
import { account, id, order } from '../services/pedidos.js';
import { renderMesaTicket } from '../services/mesa-ticket.js';

const router = Router();
router.use(requireAuth, (req, res, next) => req.path.startsWith('/historial')
  ? requirePermission('historial-mesas')(req, res, next)
  : requireCurrentForm(req, res, next));

async function ticketData(cuentaId, estado = null) {
  const data = await account(pool, cuentaId);
  if (estado && data.estado !== estado) return null;
  const pedidos = await Promise.all(data.pedidos.filter(pedido => pedido.estado !== 'cancelado').map(pedido => order(pool, pedido.idpedido)));
  const pagos = data.pagos.map(pago => ({
    ...pago,
    forma_pago: pago.nombre,
    devuelto: Number(pago.importe) - Number(pago.disponible)
  }));
  return { pedidos, pagos, cobrado: data.cobrado, saldo: data.saldo };
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.idmesa, m.numero, m.capacidad, m.fk_idubicacion_mesa,
        u.nombre AS ubicacion, CASE WHEN c.idcuenta IS NULL THEN 'libre' ELSE 'ocupado' END AS estado, m.activa,
        c.idcuenta, COALESCE(c.total, 0) AS total, c.fecha_apertura,
        cl.nombre_completo AS cliente_nombre, cl.ruc AS cliente_ruc, cl.telefono AS cliente_telefono
      FROM mesa m
      JOIN ubicacion_mesa u ON u.idubicacion_mesa = m.fk_idubicacion_mesa
      LEFT JOIN cuenta c ON c.fk_idmesa = m.idmesa AND c.estado = 'abierta'
        AND EXISTS (SELECT 1 FROM pedido p WHERE p.fk_idcuenta = c.idcuenta AND p.estado <> 'cancelado')
      LEFT JOIN cliente cl ON cl.idcliente = c.fk_idcliente
      WHERE m.activa
      ORDER BY m.numero`);
    res.json({ mesas: rows });
  } catch (error) { next(error); }
});

router.get('/historial', async (req, res, next) => {
  try {
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = [10, 25, 50].includes(Number(req.query.pageSize)) ? Number(req.query.pageSize) : 10;
    const mesaId = req.query.mesa ? id(req.query.mesa) : null;
    const params = [mesaId];
    const where = "c.tipo='SALON' AND c.estado='cerrada' AND c.fecha_cierre IS NOT NULL AND ($1::integer IS NULL OR c.fk_idmesa=$1)";
    const [count, items, mesas] = await Promise.all([
      pool.query(`SELECT count(*)::int AS total FROM cuenta c WHERE ${where}`, params),
      pool.query(`SELECT c.idcuenta, c.fk_idmesa, m.numero AS mesa_numero, cl.nombre_completo AS cliente,
        c.fecha_apertura, c.fecha_cierre, c.total
        FROM cuenta c JOIN mesa m ON m.idmesa=c.fk_idmesa
        LEFT JOIN cliente cl ON cl.idcliente=c.fk_idcliente
        WHERE ${where} ORDER BY c.fecha_cierre DESC, c.idcuenta DESC LIMIT $2 OFFSET $3`,
        [mesaId, pageSize, (page - 1) * pageSize]),
      pool.query("SELECT DISTINCT m.idmesa, m.numero FROM mesa m JOIN cuenta c ON c.fk_idmesa=m.idmesa WHERE c.tipo='SALON' AND c.estado='cerrada' ORDER BY m.numero, m.idmesa")
    ]);
    const total = count.rows[0].total;
    res.json({ items: items.rows, mesas: mesas.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.get('/historial/:cuentaId/ticket.pdf', async (req, res, next) => {
  try {
    const cuentaId = id(req.params.cuentaId);
    const { rows } = await pool.query(`SELECT c.idcuenta, c.fecha_apertura, c.fecha_cierre, c.total,
      m.numero AS mesa_numero, cl.nombre_completo AS cliente
      FROM cuenta c JOIN mesa m ON m.idmesa=c.fk_idmesa
      LEFT JOIN cliente cl ON cl.idcliente=c.fk_idcliente
      WHERE c.idcuenta=$1 AND c.tipo='SALON' AND c.estado='cerrada' AND c.fecha_cierre IS NOT NULL`, [cuentaId]);
    if (!rows.length) return res.status(404).json({ error: 'Uso de mesa cerrado no encontrado' });
    const { pedidos, pagos } = await ticketData(cuentaId);
    const pdf = await renderMesaTicket(rows[0], pedidos, pagos);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="mesa-${rows[0].mesa_numero}-cuenta-${cuentaId}.pdf"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(pdf.length)
    });
    res.send(pdf);
  } catch (error) { next(error); }
});

router.get('/cuentas/:cuentaId/ticket.pdf', async (req, res, next) => {
  try {
    const cuentaId = id(req.params.cuentaId);
    const { rows } = await pool.query(`SELECT c.idcuenta, c.estado, c.fecha_apertura, c.total,
      m.numero AS mesa_numero, cl.nombre_completo AS cliente
      FROM cuenta c JOIN mesa m ON m.idmesa=c.fk_idmesa
      LEFT JOIN cliente cl ON cl.idcliente=c.fk_idcliente
      WHERE c.idcuenta=$1 AND c.tipo='SALON' AND c.estado='abierta'`, [cuentaId]);
    if (!rows.length) return res.status(404).json({ error: 'Cuenta de mesa abierta no encontrada' });
    const data = await ticketData(cuentaId, 'abierta');
    if (!data) return res.status(404).json({ error: 'Cuenta de mesa abierta no encontrada' });
    const { pedidos, pagos, cobrado, saldo } = data;
    const pdf = await renderMesaTicket({ ...rows[0], cobrado, saldo }, pedidos, pagos);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="mesa-${rows[0].mesa_numero}-cuenta-${cuentaId}-abierta.pdf"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(pdf.length)
    });
    res.send(pdf);
  } catch (error) { next(error); }
});

router.get('/historial/:cuentaId', async (req, res, next) => {
  try {
    const cuentaId = id(req.params.cuentaId);
    const { rows } = await pool.query(`SELECT c.idcuenta, c.fk_idmesa, m.numero AS mesa_numero,
      cl.nombre_completo AS cliente, c.fecha_apertura, c.fecha_cierre, c.total
      FROM cuenta c JOIN mesa m ON m.idmesa=c.fk_idmesa
      LEFT JOIN cliente cl ON cl.idcliente=c.fk_idcliente
      WHERE c.idcuenta=$1 AND c.tipo='SALON' AND c.estado='cerrada' AND c.fecha_cierre IS NOT NULL`, [cuentaId]);
    if (!rows.length) return res.status(404).json({ error: 'Uso de mesa no encontrado' });
    const [pedidos, pagos, devoluciones] = await Promise.all([
      pool.query(`SELECT p.idpedido, p.fecha_creado, p.estado, p.monto_total, cl.nombre_completo AS cliente
        FROM pedido p LEFT JOIN cliente cl ON cl.idcliente=p.fk_idcliente
        WHERE p.fk_idcuenta=$1 ORDER BY p.idpedido`, [cuentaId]),
      pool.query(`SELECT p.idpago, p.fk_idpedido, p.fecha_creado, p.estado, p.importe,
        f.nombre AS forma_pago, COALESCE(sum(d.importe),0) AS devuelto
        FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago
        LEFT JOIN devolucion_pago d ON d.fk_idpago=p.idpago
        WHERE p.fk_idcuenta=$1
        GROUP BY p.idpago, f.nombre ORDER BY p.idpago`, [cuentaId]),
      pool.query(`SELECT d.iddevolucion_pago, d.fk_idpedido, d.fk_idpago, d.fecha_creado,
        d.importe, d.motivo FROM devolucion_pago d
        JOIN pago p ON p.idpago=d.fk_idpago WHERE p.fk_idcuenta=$1
        ORDER BY d.iddevolucion_pago`, [cuentaId])
    ]);
    res.json({ ...rows[0], pedidos: pedidos.rows, pagos: pagos.rows, devoluciones: devoluciones.rows });
  } catch (error) { next(error); }
});

router.post('/:id/abrir', async (req, res, next) => {
  try {
    const { fk_idcliente = null } = req.body || {};
    const { rows } = await pool.query('SELECT abrir_cuenta_mesa($1, $2, $3) AS idcuenta', [Number(req.params.id), fk_idcliente, req.user.login]);
    res.status(201).json({ idcuenta: rows[0].idcuenta });
  } catch (error) { next(error); }
});

router.post('/cuentas/:id/cerrar', requireCurrentForm, async (req, res, next) => {
  try {
    await pool.query('SELECT cerrar_cuenta_mesa($1, $2)', [Number(req.params.id), req.user.login]);
    res.status(204).end();
  } catch (error) { next(error); }
});

export default router;
