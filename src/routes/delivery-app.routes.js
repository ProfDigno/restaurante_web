import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../config/database.js';
import { DELIVERY_COOKIE, signDeliverySession, cookieOptions, requireDelivery } from '../middleware/delivery-auth.js';
import { loginRateLimit, recordLoginFailure, clearLoginFailures } from '../middleware/security.js';
import { auditar } from '../services/auditoria.js';
import { avisarCambio } from '../services/eventos.js';
import { restaurantInfo } from '../services/ticket-pdf.js';

// Panel del entregador (/delivery): ingreso con usuario y PIN, pedidos DELIVERY de la caja abierta
// (los suyos y los que nadie tomó), auto-asignación e indicación de la forma de pago (solo informativa).
const router = Router();
const fail = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
const route = handler => async (req, res, next) => { try { res.json(await handler(req, res)); } catch (error) { next(error); } };
const pedidoId = value => { const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0 || n > 2147483647) fail('Pedido inválido'); return n; };
const number = value => Number(value || 0);

router.get('/info', route(async () => {
  const info = await restaurantInfo(pool);
  return { nombre: info?.nombre_fantasia || info?.razon_social || 'Delivery' };
}));

router.post('/login', loginRateLimit, route(async (req, res) => {
  const login = String(req.body?.login || '').trim();
  const pin = String(req.body?.pin || '');
  if (!login || !/^\d{4}$/.test(pin)) fail('Ingresá tu usuario y el PIN de 4 números');
  const entregador = (await pool.query(`SELECT identregador_delivery, nombre_completo, usuario, password_hash FROM entregador_delivery
    WHERE lower(usuario)=lower($1) AND activo AND password_hash IS NOT NULL`, [login])).rows[0];
  if (!entregador || !(await bcrypt.compare(pin, entregador.password_hash))) {
    recordLoginFailure(req);
    fail('Usuario o PIN incorrectos', 401);
  }
  clearLoginFailures(req);
  res.cookie(DELIVERY_COOKIE, signDeliverySession(entregador), cookieOptions());
  return { entregador: { id: entregador.identregador_delivery, nombre: entregador.nombre_completo, usuario: entregador.usuario } };
}));

router.post('/logout', (req, res) => { res.clearCookie(DELIVERY_COOKIE); res.status(204).end(); });

router.use(requireDelivery);
router.get('/me', (req, res) => res.json({ entregador: req.entregador }));

// Pedidos de la caja abierta: delivery, ni borrador ni anulado, del entregador o sin asignar.
const pedidosSql = `
  SELECT p.idpedido, p.estado::text AS estado, p.fk_identregador_delivery, p.fk_idforma_pago_entrega, fe.nombre AS forma_pago_entrega,
    to_char(COALESCE(p.fecha_confirmado, p.fecha_creado),'DD/MM/YYYY') AS fecha, to_char(COALESCE(p.fecha_confirmado, p.fecha_creado),'HH24:MI') AS hora,
    cl.nombre_completo AS cliente, COALESCE(p.telefono_entrega, cl.telefono) AS telefono, COALESCE(p.direccion_entrega, cl.direccion) AS direccion,
    p.zona_nombre, p.observacion, p.monto_delivery, p.monto_descuento, p.monto_recargo, p.monto_total,
    cu.estado::text AS estado_cuenta, cu.total AS total_cuenta, cobrado_neto_cuenta(cu.idcuenta) AS cobrado,
    (SELECT string_agg(DISTINCT f.nombre, ' + ') FROM pago pg JOIN forma_pago f ON f.idforma_pago=pg.fk_idforma_pago
      WHERE pg.estado='aprobado' AND pg.fk_idcuenta=p.fk_idcuenta) AS formas_cobradas,
    EXISTS (SELECT 1 FROM rendicion_delivery_pedido r WHERE r.fk_idpedido=p.idpedido AND r.activo) AS rendido
  FROM pedido p
  JOIN cuenta cu ON cu.idcuenta=p.fk_idcuenta
  LEFT JOIN cliente cl ON cl.idcliente=p.fk_idcliente
  LEFT JOIN forma_pago fe ON fe.idforma_pago=p.fk_idforma_pago_entrega
  WHERE p.tipo_entrega='DELIVERY' AND p.estado NOT IN ('abierto','cancelado')
    AND p.fecha_creado >= $1 AND (p.fk_identregador_delivery=$2 OR p.fk_identregador_delivery IS NULL)`;

router.get('/pedidos', route(async req => {
  const caja = (await pool.query("SELECT idcaja_gral, fecha_apertura FROM caja_gral WHERE estado='abierta' ORDER BY idcaja_gral DESC LIMIT 1")).rows[0];
  if (!caja) return { caja_abierta: false, pedidos: [], formas: [] };
  const [pedidos, formas] = await Promise.all([
    pool.query(`${pedidosSql} ORDER BY p.idpedido DESC LIMIT 200`, [caja.fecha_apertura, req.entregador.id]),
    pool.query('SELECT idforma_pago, nombre FROM forma_pago WHERE activo AND es_ingreso ORDER BY orden, nombre, idforma_pago')
  ]);
  const ids = pedidos.rows.map(p => p.idpedido);
  // Productos sin ingredientes ni insumos; el subtotal incluye los agregados con precio, como en el ticket.
  // Nombre como "Categoría - Producto - Unidad".
  const lineas = ids.length ? (await pool.query(`SELECT d.fk_idpedido, concat_ws(' - ', cm.nombre, pm.nombre, um.nombre) AS nombre, d.cantidad,
      d.cantidad * (d.precio_venta + d.precio_observacion + COALESCE((SELECT SUM(dpi.precio_venta) FROM detalle_pedido_ingrediente dpi
        WHERE dpi.fk_iddetalle_pedido=d.iddetalle_pedido AND dpi.activo AND dpi.tipo_modificacion='AGREGAR'),0)) AS subtotal
    FROM detalle_pedido d JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
    LEFT JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
    LEFT JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
    WHERE d.fk_idpedido = ANY($1::int[]) AND d.estado<>'cancelado' ORDER BY d.iddetalle_pedido`, [ids])).rows : [];
  return {
    caja_abierta: true,
    formas: formas.rows,
    pedidos: pedidos.rows.map(p => {
      const saldo = p.estado_cuenta === 'abierta' ? Math.max(0, number(p.total_cuenta) - number(p.cobrado)) : 0;
      return {
        idpedido: p.idpedido, estado: p.estado, fecha: p.fecha, hora: p.hora, mio: p.fk_identregador_delivery === req.entregador.id,
        cliente: p.cliente, telefono: p.telefono, direccion: p.direccion, zona: p.zona_nombre, observacion: p.observacion,
        productos: lineas.filter(l => l.fk_idpedido === p.idpedido).map(l => ({ nombre: l.nombre, cantidad: number(l.cantidad), subtotal: number(l.subtotal) })),
        descuento: number(p.monto_descuento), recargo: number(p.monto_recargo), delivery: number(p.monto_delivery), total: number(p.monto_total), saldo,
        formas_cobradas: p.formas_cobradas, fk_idforma_pago_entrega: p.fk_idforma_pago_entrega, forma_pago_entrega: p.forma_pago_entrega,
        rendido: p.rendido, puede_indicar_forma: p.fk_identregador_delivery === req.entregador.id && !p.rendido && !p.formas_cobradas && saldo > 0
      };
    })
  };
}));

async function transaccion(handler) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await handler(c);
    await c.query('COMMIT');
    avisarCambio();
    return result;
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
}

// Auto-asignación: un solo UPDATE condicionado, así dos entregadores no pueden tomar el mismo pedido.
// Solo cambia el entregador (como en Pagos a delivery): el trigger lo permite también con la cuenta ya cobrada.
router.post('/pedidos/:id/asignarme', route(req => transaccion(async c => {
  const idpedido = pedidoId(req.params.id);
  const { rowCount } = await c.query(`UPDATE pedido SET fk_identregador_delivery=$1
    WHERE idpedido=$2 AND tipo_entrega='DELIVERY' AND fk_identregador_delivery IS NULL AND estado NOT IN ('abierto','cancelado')`, [req.entregador.id, idpedido]);
  if (!rowCount) {
    const actual = (await c.query('SELECT fk_identregador_delivery FROM pedido WHERE idpedido=$1', [idpedido])).rows[0];
    if (actual?.fk_identregador_delivery === req.entregador.id) return { idpedido };
    fail(actual?.fk_identregador_delivery ? 'Otro entregador ya tomó este pedido' : 'El pedido ya no está disponible', 409);
  }
  await auditar(c, req.user, { accion: 'ENTREGADOR_ASIGNADO', entidad: 'pedido', id: idpedido,
    antes: { entregador: null }, despues: { entregador: req.entregador.nombre, por: 'auto-asignación' } });
  return { idpedido };
})));

// Forma de pago indicada por el entregador: no cobra ni mueve la caja; la Rendición la propone.
router.put('/pedidos/:id/forma-pago', route(req => transaccion(async c => {
  const idpedido = pedidoId(req.params.id);
  const formaId = Number(req.body?.fk_idforma_pago);
  const forma = Number.isSafeInteger(formaId) && formaId > 0
    ? (await c.query('SELECT idforma_pago, nombre FROM forma_pago WHERE idforma_pago=$1 AND activo AND es_ingreso', [formaId])).rows[0] : null;
  if (!forma) fail('Elegí una forma de pago activa');
  const pedido = (await c.query(`SELECT p.idpedido, p.fk_idcuenta, cu.estado::text AS estado_cuenta, fe.nombre AS anterior
    FROM pedido p JOIN cuenta cu ON cu.idcuenta=p.fk_idcuenta LEFT JOIN forma_pago fe ON fe.idforma_pago=p.fk_idforma_pago_entrega
    WHERE p.idpedido=$1 AND p.tipo_entrega='DELIVERY' AND p.estado<>'cancelado' AND p.fk_identregador_delivery=$2 FOR UPDATE OF p`, [idpedido, req.entregador.id])).rows[0];
  if (!pedido) fail('Pedido no encontrado', 404);
  if (pedido.estado_cuenta !== 'abierta') fail('El pedido ya está cobrado', 409);
  if ((await c.query('SELECT 1 FROM rendicion_delivery_pedido WHERE fk_idpedido=$1 AND activo', [idpedido])).rowCount) fail('El pedido ya fue rendido', 409);
  if ((await c.query("SELECT 1 FROM pago WHERE fk_idcuenta=$1 AND estado='aprobado'", [pedido.fk_idcuenta])).rowCount) fail('El pedido ya tiene un cobro registrado', 409);
  await c.query('UPDATE pedido SET fk_idforma_pago_entrega=$1, version_web=version_web+1 WHERE idpedido=$2', [forma.idforma_pago, idpedido]);
  await auditar(c, req.user, { accion: 'PEDIDO_FORMA_PAGO_ENTREGA', entidad: 'pedido', id: idpedido,
    antes: { forma_pago: pedido.anterior }, despues: { forma_pago: forma.nombre, entregador: req.entregador.nombre } });
  return { idpedido, fk_idforma_pago_entrega: forma.idforma_pago, forma_pago_entrega: forma.nombre };
})));

export default router;
