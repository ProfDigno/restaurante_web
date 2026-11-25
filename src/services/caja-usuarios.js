// Resumen de la caja abierta por usuario (el que creó el pedido): cobrado en la caja por forma de pago
// y lo que todavía falta cobrar. Un pago de cuenta (mesa cobrada entera, sin pedido) y el saldo de una
// cuenta abierta se reparten entre sus pedidos en proporción a su total.

// Reparte `amount` entre `orders` ([{idpedido, usuario, monto_total}]) proporcional al total; el resto
// del redondeo va al último, así la suma cierra exacta.
function split(amount, orders) {
  if (!orders.length) return [];
  const base = orders.reduce((s, o) => s + Number(o.monto_total), 0);
  let left = amount;
  return orders.map((o, i) => {
    const part = i === orders.length - 1 ? left : base > 0 ? Math.round(amount * Number(o.monto_total) / base) : Math.round(amount / orders.length);
    left -= part;
    return { ...o, monto: part };
  });
}

export async function resumenPorUsuario(client, cajaId) {
  const [movs, pendientes, cuentasPedidos] = await Promise.all([
    client.query(`
      SELECT f.idforma_pago, f.nombre AS forma, f.orden, pg.fk_idpedido, pg.fk_idcuenta,
        CASE WHEN i.tipo_movimiento='ingreso' THEN i.monto_pago ELSE -i.monto_pago END AS monto
      FROM caja_item i JOIN pago pg ON pg.idpago=i.fk_idpago JOIN forma_pago f ON f.idforma_pago=i.fk_idforma_pago
      WHERE i.fk_idcaja_gral=$1 AND i.fk_idpago IS NOT NULL`, [cajaId]),
    client.query(`
      SELECT c.idcuenta, c.total - cobrado_neto_cuenta(c.idcuenta) AS saldo
      FROM cuenta c
      WHERE c.estado='abierta' AND EXISTS (SELECT 1 FROM pedido p WHERE p.fk_idcuenta=c.idcuenta AND p.estado<>'cancelado')
        AND c.total - cobrado_neto_cuenta(c.idcuenta) > 0`),
    client.query(`
      SELECT p.idpedido, p.fk_idcuenta, p.monto_total, p.monto_delivery, p.creado_por AS usuario
      FROM pedido p WHERE p.estado<>'cancelado' AND p.fk_idcuenta IN (
        SELECT pg.fk_idcuenta FROM caja_item i JOIN pago pg ON pg.idpago=i.fk_idpago WHERE i.fk_idcaja_gral=$1
        UNION SELECT c.idcuenta FROM cuenta c WHERE c.estado='abierta')
      ORDER BY p.idpedido`, [cajaId])
  ]);

  const byAccount = new Map(), byOrder = new Map();
  for (const o of cuentasPedidos.rows) {
    byOrder.set(o.idpedido, o);
    if (!byAccount.has(o.fk_idcuenta)) byAccount.set(o.fk_idcuenta, []);
    byAccount.get(o.fk_idcuenta).push(o);
  }
  const rows = new Map(), formas = new Map();
  const row = login => {
    if (!rows.has(login)) rows.set(login, { usuario: login, formas: {}, delivery_formas: {}, total_cobrado: 0, delivery: 0, pedidos: new Set(), pendiente: 0, pedidos_pendientes: new Set() });
    return rows.get(login);
  };

  for (const m of movs.rows) {
    const monto = Number(m.monto);
    if (!monto) continue;
    formas.set(m.forma, Number(m.orden));
    const order = m.fk_idpedido ? byOrder.get(m.fk_idpedido) : null;
    const parts = order ? [{ ...order, monto }] : split(monto, byAccount.get(m.fk_idcuenta) || []);
    if (!parts.length) parts.push({ idpedido: null, usuario: 'SIN PEDIDO', monto });
    for (const p of parts) {
      const r = row(p.usuario);
      r.formas[m.forma] = (r.formas[m.forma] || 0) + p.monto;
      r.total_cobrado += p.monto;
      // Parte del cobro que corresponde al delivery del pedido (proporcional a su total).
      const total = Number(p.monto_total || 0), delivery = Number(p.monto_delivery || 0);
      const parteDelivery = total > 0 && delivery > 0 ? Math.round(p.monto * Math.min(delivery, total) / total) : 0;
      if (parteDelivery) {
        r.delivery_formas[m.forma] = (r.delivery_formas[m.forma] || 0) + parteDelivery;
        r.delivery += parteDelivery;
      }
      if (p.idpedido) r.pedidos.add(p.idpedido);
    }
  }
  for (const a of pendientes.rows) {
    for (const p of split(Number(a.saldo), byAccount.get(a.idcuenta) || [])) {
      if (!p.monto) continue;
      const r = row(p.usuario);
      r.pendiente += p.monto;
      r.pedidos_pendientes.add(p.idpedido);
    }
  }

  const logins = [...rows.keys()];
  const names = new Map((await client.query('SELECT login, nombre FROM usuario WHERE login = ANY($1)', [logins])).rows.map(u => [u.login, u.nombre]));
  const formasOrden = [...formas].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([nombre]) => nombre);
  const filas = [...rows.values()].map(r => ({ usuario: r.usuario, nombre: names.get(r.usuario) || r.usuario, formas: r.formas, total_cobrado: r.total_cobrado,
    delivery_formas: r.delivery_formas, delivery: r.delivery,
    pedidos: r.pedidos.size, pendiente: r.pendiente, pedidos_pendientes: r.pedidos_pendientes.size }))
    .sort((a, b) => b.total_cobrado - a.total_cobrado || b.pendiente - a.pendiente || a.nombre.localeCompare(b.nombre));
  const totales = { formas: {}, delivery_formas: {}, total_cobrado: 0, delivery: 0, pedidos: 0, pendiente: 0, pedidos_pendientes: 0 };
  for (const f of filas) {
    for (const [k, v] of Object.entries(f.formas)) totales.formas[k] = (totales.formas[k] || 0) + v;
    for (const [k, v] of Object.entries(f.delivery_formas)) totales.delivery_formas[k] = (totales.delivery_formas[k] || 0) + v;
    totales.total_cobrado += f.total_cobrado; totales.delivery += f.delivery; totales.pedidos += f.pedidos; totales.pendiente += f.pendiente; totales.pedidos_pendientes += f.pedidos_pendientes;
  }
  return { formas: formasOrden, filas, totales };
}
