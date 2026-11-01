import { pool } from '../config/database.js';

export function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
export function integer(value, name, min = 0) {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > 99999999999999) fail(`${name}: ingresá un entero válido`);
  return Number(value);
}
export const id = (value, min = 1) => { const n = integer(value, 'Identificador', min); if (n > 2147483647) fail('Identificador fuera de rango'); return n; };
export const textRequired = (value, label) => { const s = String(value || '').trim(); if (!s) fail(`${label} es obligatorio`); return s; };

// Same key + same request replays the committed result, including after a lost response.
export async function operation(req, action) {
  const key = String(req.body?.clave || '');
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(key)) fail('Falta la clave de la operación');
  const c = await pool.connect();
  const request = { user: req.user.sub, method: req.method, path: req.originalUrl, body: req.body };
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(7092026)');
    const old = (await c.query('SELECT respuesta, solicitud = $2::jsonb AS coincide FROM operacion_web WHERE clave=$1', [key, JSON.stringify(request)])).rows[0];
    if (old) { if (!old.coincide) fail('La clave ya fue utilizada para otra operación', 409); await c.query('COMMIT'); return old.respuesta; }
    const result = await action(c);
    await c.query('INSERT INTO operacion_web(clave,solicitud,respuesta,creado_por) VALUES($1,$2,$3,$4)', [key, JSON.stringify(request), JSON.stringify(result), req.user.login]);
    await c.query('COMMIT'); return result;
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
}

export async function account(c, accountId, lock = false) {
  const a = (await c.query(`SELECT *, cobrado_neto_cuenta(idcuenta) AS cobrado FROM cuenta WHERE idcuenta=$1 ${lock ? 'FOR UPDATE' : ''}`, [id(accountId)])).rows[0];
  if (!a) fail('Cuenta no encontrada', 404);
  a.pedidos = (await c.query('SELECT p.*,cl.nombre_completo FROM pedido p LEFT JOIN cliente cl ON cl.idcliente=p.fk_idcliente WHERE fk_idcuenta=$1 ORDER BY idpedido', [a.idcuenta])).rows;
  a.pagos = (await c.query(`SELECT p.*, f.nombre, p.importe-COALESCE((SELECT SUM(d.importe) FROM devolucion_pago d WHERE d.fk_idpago=p.idpago),0) AS disponible
    FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago WHERE p.fk_idcuenta=$1 ORDER BY p.idpago`, [a.idcuenta])).rows;
  a.devoluciones = (await c.query('SELECT d.* FROM devolucion_pago d JOIN pago p ON p.idpago=d.fk_idpago WHERE p.fk_idcuenta=$1 ORDER BY d.iddevolucion_pago', [a.idcuenta])).rows;
  a.saldo = Number(a.total) - Number(a.cobrado);
  return a;
}
export async function order(c, orderId) {
  const p = (await c.query('SELECT * FROM pedido WHERE idpedido=$1', [id(orderId)])).rows[0];
  if (!p) fail('Pedido no encontrado', 404);
  p.detalles = (await c.query(`SELECT d.*,pm.nombre,cm.nombre || ' - ' || pm.nombre AS nombre_mostrado,um.nombre AS unidad FROM detalle_pedido d JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu WHERE fk_idpedido=$1 AND d.estado<>'cancelado' ORDER BY iddetalle_pedido`, [p.idpedido])).rows;
  const modifications = (await c.query(`SELECT dpi.iddetalle_pedido_ingrediente, dpi.fk_iddetalle_pedido, dpi.fk_idingrediente AS idingrediente,
    dpi.tipo_modificacion, dpi.cantidad, dpi.precio_venta, i.nombre, u.codigo AS unidad_codigo
    FROM detalle_pedido_ingrediente dpi JOIN detalle_pedido dp ON dp.iddetalle_pedido=dpi.fk_iddetalle_pedido
    JOIN ingrediente i ON i.idingrediente=dpi.fk_idingrediente JOIN unidad_medida u ON u.idunidad_medida=i.fk_idunidad_medida
    WHERE dp.fk_idpedido=$1 AND dpi.activo ORDER BY dpi.iddetalle_pedido_ingrediente`, [p.idpedido])).rows;
  for (const detail of p.detalles) detail.ingredientes = modifications.filter(item=>item.fk_iddetalle_pedido===detail.iddetalle_pedido);
  p.cliente = (await c.query('SELECT c.*,z.precio_delivery,z.activo AS zona_activa FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente=c.fk_idzona_cliente WHERE c.idcliente=$1', [p.fk_idcliente])).rows[0];
  if (p.fk_idmesa) p.numero_mesa = (await c.query('SELECT numero FROM mesa WHERE idmesa=$1', [p.fk_idmesa])).rows[0]?.numero || null;
  if (p.fk_identregador_delivery) p.entregador_nombre = (await c.query('SELECT nombre_completo FROM entregador_delivery WHERE identregador_delivery=$1', [p.fk_identregador_delivery])).rows[0]?.nombre_completo || null;
  p.pago_anticipado = (await c.query(`SELECT p.idpago,p.fk_idforma_pago,f.nombre AS forma_pago_nombre,p.importe,p.estado,
    COALESCE((SELECT SUM(d.importe) FROM devolucion_pago d WHERE d.fk_idpago=p.idpago),0) AS devuelto
    FROM pago p JOIN forma_pago f ON f.idforma_pago=p.fk_idforma_pago WHERE p.fk_idpedido=$1`, [p.idpedido])).rows[0] || null;
  p.saldo_cuenta = Number((await c.query('SELECT total-cobrado_neto_cuenta(idcuenta) AS saldo FROM cuenta WHERE idcuenta=$1', [p.fk_idcuenta])).rows[0].saldo);
  return p;
}

async function syncLineIngredients(c, detailId, productId, requested, user) {
  if (requested === undefined) return;
  if (!Array.isArray(requested) || requested.length > 100) fail('Lista de ingredientes inválida');
  const existing = (await c.query('SELECT iddetalle_pedido_ingrediente, fk_idingrediente, tipo_modificacion, activo FROM detalle_pedido_ingrediente WHERE fk_iddetalle_pedido=$1', [detailId])).rows;
  const desired = new Map();
  for (const item of requested) {
    const ingredientId = id(item?.idingrediente,0);
    const type = item?.tipo_modificacion;
    if (!['AGREGAR','QUITAR'].includes(type)) fail('Tipo de ingrediente inválido');
    if (desired.has(ingredientId)) fail('Un ingrediente no puede repetirse ni agregarse y quitarse a la vez');
    desired.set(ingredientId, type);
  }
  for (const previous of existing) {
    if (!previous.activo || desired.get(previous.fk_idingrediente) === previous.tipo_modificacion) continue;
    await c.query(`UPDATE detalle_pedido_ingrediente SET activo=false,fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado='Eliminado desde el formulario' WHERE iddetalle_pedido_ingrediente=$2`, [user.login,previous.iddetalle_pedido_ingrediente]);
  }
  for (const [ingredientId,type] of desired) {
    const previous = existing.find(item=>item.fk_idingrediente===ingredientId && item.tipo_modificacion===type);
    if (previous?.activo) continue;
    const relation = (await c.query(`SELECT pi.cantidad,i.precio_venta FROM producto_menu_ingrediente pi JOIN ingrediente i ON i.idingrediente=pi.fk_idingrediente
      WHERE pi.fk_idproducto_menu=$1 AND pi.fk_idingrediente=$2 AND i.activo`, [productId,ingredientId])).rows[0];
    if (!relation) fail('El ingrediente no está activo o no pertenece al producto');
    if (previous) {
      await c.query(`UPDATE detalle_pedido_ingrediente SET activo=true,cantidad=$1,precio_venta=$2,fecha_anulado=NULL,anulado_por=NULL,motivo_anulado=NULL WHERE iddetalle_pedido_ingrediente=$3`, [relation.cantidad,type==='AGREGAR'?relation.precio_venta:0,previous.iddetalle_pedido_ingrediente]);
    } else {
      await c.query('INSERT INTO detalle_pedido_ingrediente(fk_iddetalle_pedido,fk_idingrediente,tipo_modificacion,cantidad,precio_venta,creado_por) VALUES($1,$2,$3,$4,0,$5)', [detailId,ingredientId,type,relation.cantidad,user.login]);
    }
  }
}

export async function saveOrder(c, body, user, orderId = null) {
  const lines = body.detalles;
  if (!Array.isArray(lines) || !lines.length || lines.length > 300) fail('Agregá entre 1 y 300 líneas al pedido');
  const discount = integer(body.monto_descuento ?? 0, 'Descuento');
  const advance = body.pago_anticipado_nuevo;
  if (advance !== undefined && (advance === null || typeof advance !== 'object' || Array.isArray(advance))) fail('Pago anticipado inválido');
  const advanceAmount = integer(advance?.importe ?? 0, 'Pago anticipado');
  let courierId = body.fk_identregador_delivery == null || body.fk_identregador_delivery === '' ? null : id(body.fk_identregador_delivery);
  if (discount) textRequired(body.motivo_descuento, 'El motivo del descuento');
  let p, a;
  if (orderId) {
    p = await order(c, orderId); a = await account(c, p.fk_idcuenta, true);
    if (body.fk_identregador_delivery === undefined) courierId = p.fk_identregador_delivery;
    if (p.estado !== 'en_preparacion' || a.estado !== 'abierta') fail('El pedido ya no admite edición', 409);
    if (p.version_web !== id(body.version_web)) fail('El pedido cambió. Volvé a cargarlo antes de guardar', 409);
    if (body.tipo_entrega !== p.tipo_entrega || Number(body.fk_idmesa || 0) !== Number(p.fk_idmesa || 0) || Number(body.fk_idcliente) !== p.fk_idcliente) fail('Tipo, mesa y cliente quedan fijos después de guardar');
    if (p.tipo_entrega !== 'DELIVERY' && courierId !== null) fail('Solo los pedidos Delivery admiten entregador');
    // Remove discount temporarily so line-by-line triggers never see an intermediate negative total.
    await c.query('UPDATE pedido SET monto_descuento=0 WHERE idpedido=$1', [p.idpedido]);
  } else {
    const type = body.tipo_entrega;
    if (!['COMER_ACA', 'DELIVERY', 'BUSCAR'].includes(type)) fail('Tipo de entrega inválido');
    if (type !== 'DELIVERY' && courierId !== null) fail('Solo los pedidos Delivery admiten entregador');
    if (!body.fk_idcliente) fail('Seleccioná un cliente activo');
    const clientId = id(body.fk_idcliente);
    const client = (await c.query('SELECT * FROM cliente WHERE idcliente=$1 AND activo', [clientId])).rows[0];
    if (!client) fail('Seleccioná un cliente activo');
    if (type === 'COMER_ACA') {
      if (!body.fk_idmesa) fail('Seleccioná una mesa antes de guardar el pedido');
      const mesa = (await c.query('SELECT * FROM mesa WHERE idmesa=$1 AND activa FOR UPDATE', [id(body.fk_idmesa)])).rows[0];
      if (!mesa) fail('Seleccioná una mesa activa');
      let existing = (await c.query("SELECT idcuenta FROM cuenta WHERE fk_idmesa=$1 AND estado='abierta'", [mesa.idmesa])).rows[0];
      if (!existing) existing = (await c.query('SELECT abrir_cuenta_mesa($1,$2,$3) AS idcuenta', [mesa.idmesa, clientId, user.login])).rows[0];
      a = await account(c, existing.idcuenta, true);
      if (a.pedidos.length && a.fk_idcliente && a.fk_idcliente !== clientId) fail('El cliente debe coincidir con la cuenta de la mesa');
      if (!a.pedidos.length) await c.query('UPDATE cuenta SET fk_idcliente=$1 WHERE idcuenta=$2', [clientId,a.idcuenta]);
      p = (await c.query("INSERT INTO pedido(fk_idmesa,fk_idcuenta,fk_idcliente,tipo_entrega,creado_por) VALUES($1,$2,$3,'COMER_ACA',$4) RETURNING *", [mesa.idmesa,a.idcuenta,clientId,user.login])).rows[0];
    } else {
      if (type === 'DELIVERY' && (!client.direccion?.trim() || !client.telefono?.trim())) fail('Delivery requiere dirección y teléfono');
      const r = (await c.query('SELECT crear_pedido_externo($1,$2,$3,$4) AS idpedido', [type, clientId,body.observacion || null,user.login])).rows[0];
      p = await order(c,r.idpedido); a = await account(c,p.fk_idcuenta,true);
    }
  }
  const kept = new Set();
  for (const line of lines) {
    const quantity = integer(line.cantidad,'Cantidad',1);
    if (line.iddetalle_pedido) {
      const old = p.detalles?.find(x=>x.iddetalle_pedido === id(line.iddetalle_pedido));
      if (!old || kept.has(old.iddetalle_pedido)) fail('Detalle inválido o repetido');
      kept.add(old.iddetalle_pedido);
      if (Number(line.fk_idproducto_menu) !== old.fk_idproducto_menu) fail('No se puede reemplazar un producto histórico');
      if (quantity !== Number(old.cantidad)) {
        if (quantity > Number(old.cantidad)) await sellable(c,old.fk_idproducto_menu);
        await c.query('UPDATE detalle_pedido SET cantidad=$1 WHERE iddetalle_pedido=$2',[quantity,old.iddetalle_pedido]);
      }
      await syncLineIngredients(c,old.iddetalle_pedido,old.fk_idproducto_menu,line.ingredientes,user);
    } else {
      const product = await sellable(c,id(line.fk_idproducto_menu, 0));
      const keepQuotedPrice = line.precio_fijado === true && user.permisos?.includes('FORM_MENU');
      const salePrice = keepQuotedPrice ? integer(line.precio_venta, 'Precio de venta') : product.precio_venta;
      const inserted = await c.query('INSERT INTO detalle_pedido(fk_idpedido,fk_idproducto_menu,cantidad,precio_venta,precio_compra,creado_por) VALUES($1,$2,$3,$4,$5,$6) RETURNING iddetalle_pedido', [p.idpedido,product.idproducto_menu,quantity,product.precio_venta,product.precio_compra,user.login]);
      if (keepQuotedPrice && Number(salePrice) !== Number(product.precio_venta)) {
        await c.query('UPDATE detalle_pedido SET precio_venta=$1 WHERE iddetalle_pedido=$2', [salePrice,inserted.rows[0].iddetalle_pedido]);
      }
      await syncLineIngredients(c,inserted.rows[0].iddetalle_pedido,product.idproducto_menu,line.ingredientes,user);
    }
  }
  for (const old of p.detalles || []) if (!kept.has(old.iddetalle_pedido)) {
    await c.query("UPDATE detalle_pedido SET estado='cancelado',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado='Eliminado desde el formulario' WHERE iddetalle_pedido=$2",[user.login,old.iddetalle_pedido]);
  }
  await c.query('UPDATE pedido SET monto_descuento=$1,motivo_descuento=$2,observacion=$3,fk_identregador_delivery=$4,version_web=version_web+1 WHERE idpedido=$5', [discount,discount ? body.motivo_descuento.trim() : null,body.observacion || null,courierId,p.idpedido]);
  if (!orderId) {
    await c.query('SELECT confirmar_pedido($1,$2,$3)',[p.idpedido,user.sub,user.login]);
    await c.query("UPDATE pedido SET estado='en_preparacion' WHERE idpedido=$1",[p.idpedido]);
  } else await c.query('SELECT sincronizar_stock_pedido($1,$2,$3)',[p.idpedido,user.sub,user.login]);
  const saved = await order(c,p.idpedido);
  if (saved.pago_anticipado && Number(saved.pago_anticipado.importe) > Number(saved.monto_total)) {
    fail('El total del pedido no puede quedar por debajo del pago anticipado');
  }
  if (advanceAmount) {
    if (saved.pago_anticipado) fail('Este pedido ya tiene un pago anticipado',409);
    if (advanceAmount > Number(saved.monto_total)) fail('El pago anticipado no puede superar el total del pedido');
    const currentAccount = await account(c,saved.fk_idcuenta,true);
    if (advanceAmount > currentAccount.saldo) fail('El pago anticipado no puede superar el saldo de la cuenta');
    const formId = id(advance.fk_idforma_pago);
    const form = await c.query('SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND activo AND es_ingreso',[formId]);
    if (!form.rowCount) fail('Seleccioná una forma de pago activa para ingresos');
    const cash = await c.query("SELECT idcaja_gral FROM caja_gral WHERE estado='abierta' FOR UPDATE");
    if (!cash.rowCount) fail('Abrí una caja antes de cobrar');
    await c.query("INSERT INTO pago(fk_idcuenta,fk_idpedido,fk_idforma_pago,importe,estado,creado_por) VALUES($1,$2,$3,$4,'aprobado',$5)",
      [saved.fk_idcuenta,saved.idpedido,formId,advanceAmount,user.login]);
  }
  return { pedido: await order(c,p.idpedido) };
}
async function sellable(c, productId) {
  const p = (await c.query('SELECT * FROM producto_menu WHERE idproducto_menu=$1 AND activo AND es_vender FOR SHARE',[productId])).rows[0];
  if (!p) fail('El producto no está activo o habilitado para vender');
  return p;
}
export async function finishOrder(c, orderId, version = null, user = null) {
  const current = await order(c,orderId);
  const a = await account(c,current.fk_idcuenta,true);
  const p = await order(c,orderId);
  if (version !== null && p.version_web !== id(version)) fail('El pedido cambió. Volvé a cargarlo antes de terminar',409);
  if (a.estado !== 'abierta' || p.estado !== 'en_preparacion') fail('Solo se pueden terminar pedidos en COCINA',409);
  await c.query("UPDATE detalle_pedido SET estado='listo' WHERE fk_idpedido=$1 AND estado<>'cancelado'",[p.idpedido]);
  await c.query("UPDATE pedido SET estado='listo',version_web=version_web+1 WHERE idpedido=$1",[p.idpedido]);
  const updatedAccount = await account(c,p.fk_idcuenta,true);
  if (updatedAccount.saldo === 0 && updatedAccount.pagos.some(pay=>pay.fk_idpedido && pay.estado==='aprobado' && Number(pay.disponible)>0)
    && updatedAccount.pedidos.every(item=>['listo','entregado','pagado','cancelado'].includes(item.estado))) {
    await c.query('SELECT cerrar_cuenta_mesa($1,$2)',[updatedAccount.idcuenta,user?.login || p.creado_por]);
  }
  return { pedido: await order(c,p.idpedido) };
}
export async function collect(c, accountId, body, user) {
  const a = await account(c,accountId,true);
  if (a.estado !== 'abierta') fail('La cuenta está cerrada',409);
  if (a.pedidos.some(p=>!['listo','entregado','pagado','cancelado'].includes(p.estado))) fail('Primero terminá todos los pedidos de la cuenta');
  if (!Array.isArray(body.pagos) || body.pagos.length > 30) fail('Pagos inválidos');
  const total = body.pagos.reduce((sum,p)=>sum+integer(p.importe,'Importe',1),0);
  if (total > a.saldo || (!total && a.saldo)) fail('El importe debe ser mayor a cero y no superar el saldo');
  if (total && !(await c.query("SELECT idcaja_gral FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount) fail('Abrí una caja antes de cobrar');
  for (const pay of body.pagos) await c.query("INSERT INTO pago(fk_idcuenta,fk_idforma_pago,importe,estado,creado_por) VALUES($1,$2,$3,'aprobado',$4)",[a.idcuenta,id(pay.fk_idforma_pago),integer(pay.importe,'Importe',1),user.login]);
  if (total === a.saldo) await c.query('SELECT cerrar_cuenta_mesa($1,$2)',[a.idcuenta,user.login]);
  return { cuenta: await account(c,a.idcuenta) };
}
export async function cancellationPreview(c,orderId) {
  const p = await order(c,orderId); const a = await account(c,p.fk_idcuenta,true);
  if (p.estado === 'cancelado') fail('El pedido ya fue anulado',409);
  const newTotal = Number(a.total)-Number(p.monto_total);
  if (newTotal < 0) fail('Primero ajustá el descuento de la cuenta: excedería los pedidos restantes');
  return { pedido:p,cuenta:a,nuevo_total:newTotal,devolver:Math.max(0,Number(a.cobrado)-newTotal) };
}
export async function cancelOrder(c,orderId,body,user) {
  const preview = await cancellationPreview(c,orderId); const reason=textRequired(body.motivo,'El motivo');
  const refunds=body.devoluciones || []; if (!Array.isArray(refunds) || refunds.length>100) fail('Devoluciones inválidas');
  let amount=0; const used=new Set();
  for (const r of refunds) {
    const pay=preview.cuenta.pagos.find(p=>p.idpago===id(r.fk_idpago) && p.estado==='aprobado');
    const value=integer(r.importe,'Devolución',1);
    if (!pay || used.has(pay.idpago) || value>Number(pay.disponible)) fail('Distribución de devolución inválida');
    used.add(pay.idpago); amount+=value;
  }
  if (amount !== preview.devolver) fail('El importe a devolver cambió. Revisá la distribución',409);
  await c.query('SELECT anular_pedido($1,$2,$3,$4)',[preview.pedido.idpedido,user.sub,user.login,reason]);
  for (const r of refunds) await c.query('INSERT INTO devolucion_pago(fk_idpedido,fk_idpago,importe,motivo,creado_por) VALUES($1,$2,$3,$4,$5)',[preview.pedido.idpedido,r.fk_idpago,r.importe,reason,user.login]);
  return { pedido:await order(c,orderId),cuenta:await account(c,preview.cuenta.idcuenta) };
}
