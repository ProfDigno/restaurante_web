import { pool } from '../config/database.js';
import { weekNames } from './kpi-gastos.js';

// Datos del Análisis de pedidos (por fecha de confirmación): lo usan la pantalla, el PDF y el Excel.
// Suman los pedidos confirmados que no están abiertos ni cancelados; los cancelados se informan aparte.
const number = value => Number(value || 0);
const numericRows = (rows, fields) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fields.includes(key) ? number(value) : value])));
export const entregaLabel = tipo => ({ COMER_ACA: 'Comer acá', DELIVERY: 'Delivery', BUSCAR: 'Buscar' })[tipo] || tipo;

export async function kpiPedidos(inicio, fin, { detalle = false } = {}) {
  const dates = [inicio, fin];
  const inRange = "p.fecha_confirmado >= $1::date AND p.fecha_confirmado < ($2::date + INTERVAL '1 day')";
  const sales = `${inRange} AND p.estado NOT IN ('abierto','cancelado')`;
  const [summary, daily, deliveries, tables, zones, products, categories, groups, customers, payments, cancelled, list] = await Promise.all([
    pool.query(`WITH periods AS (
      SELECT 'actual' AS periodo, count(*)::int AS pedidos, COALESCE(sum(monto_total),0) AS monto FROM pedido p WHERE ${sales}
      UNION ALL
      SELECT 'anterior', count(*)::int, COALESCE(sum(monto_total),0) FROM pedido p
      WHERE p.fecha_confirmado >= ($1::date - (($2::date - $1::date) + 1))
        AND p.fecha_confirmado < $1::date AND p.estado NOT IN ('abierto','cancelado')
    ) SELECT * FROM periods`, dates),
    pool.query(`SELECT to_char(d.dia,'YYYY-MM-DD') AS fecha, count(p.idpedido)::int AS pedidos,
      COALESCE(sum(p.monto_total),0) AS monto
      FROM generate_series($1::date,$2::date,INTERVAL '1 day') AS d(dia)
      LEFT JOIN pedido p ON p.fecha_confirmado >= d.dia AND p.fecha_confirmado < d.dia + INTERVAL '1 day'
        AND p.estado NOT IN ('abierto','cancelado')
      GROUP BY d.dia ORDER BY d.dia`, dates),
    pool.query(`SELECT p.tipo_entrega AS nombre,count(*)::int AS pedidos,sum(p.monto_total) AS monto
      FROM pedido p WHERE ${sales} GROUP BY p.tipo_entrega ORDER BY monto DESC`, dates),
    pool.query(`SELECT m.numero::text AS nombre,count(*)::int AS pedidos,sum(p.monto_total) AS monto
      FROM pedido p JOIN mesa m ON m.idmesa=p.fk_idmesa WHERE ${sales}
      GROUP BY m.idmesa,m.numero ORDER BY pedidos DESC,monto DESC LIMIT 10`, dates),
    pool.query(`SELECT COALESCE(NULLIF(p.zona_nombre,''),'Sin zona') AS nombre,count(*)::int AS pedidos,
      sum(p.monto_total) AS monto FROM pedido p WHERE ${sales} AND p.tipo_entrega='DELIVERY'
      GROUP BY COALESCE(NULLIF(p.zona_nombre,''),'Sin zona') ORDER BY pedidos DESC,monto DESC LIMIT 10`, dates),
    pool.query(`SELECT cm.nombre || ' · ' || um.nombre || ' · ' || pm.nombre AS nombre,
      pm.idproducto_menu AS id,sum(dp.cantidad) AS unidades,
      sum(dp.cantidad*dp.precio_venta) AS monto FROM pedido p
      JOIN detalle_pedido dp ON dp.fk_idpedido=p.idpedido AND dp.estado<>'cancelado'
      JOIN producto_menu pm ON pm.idproducto_menu=dp.fk_idproducto_menu
      JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
      JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
      WHERE ${sales} GROUP BY pm.idproducto_menu,pm.nombre,cm.nombre,um.nombre ORDER BY unidades DESC,monto DESC LIMIT 10`, dates),
    pool.query(`SELECT cm.nombre,cm.idcategoria_menu AS id,sum(dp.cantidad) AS unidades,
      sum(dp.cantidad*dp.precio_venta) AS monto FROM pedido p
      JOIN detalle_pedido dp ON dp.fk_idpedido=p.idpedido AND dp.estado<>'cancelado'
      JOIN producto_menu pm ON pm.idproducto_menu=dp.fk_idproducto_menu
      JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
      WHERE ${sales} GROUP BY cm.idcategoria_menu,cm.nombre ORDER BY unidades DESC,monto DESC LIMIT 10`, dates),
    pool.query(`SELECT gm.nombre,gm.idgrupo_menu AS id,sum(dp.cantidad) AS unidades,
      sum(dp.cantidad*dp.precio_venta) AS monto FROM pedido p
      JOIN detalle_pedido dp ON dp.fk_idpedido=p.idpedido AND dp.estado<>'cancelado'
      JOIN producto_menu pm ON pm.idproducto_menu=dp.fk_idproducto_menu
      JOIN grupo_menu gm ON gm.idgrupo_menu=pm.fk_idgrupo_menu
      WHERE ${sales} GROUP BY gm.idgrupo_menu,gm.nombre ORDER BY unidades DESC,monto DESC LIMIT 10`, dates),
    pool.query(`SELECT count(*)::int AS nuevos FROM (
      SELECT p.fk_idcliente,min(p.fecha_confirmado) AS primera
      FROM pedido p JOIN cliente c ON c.idcliente=p.fk_idcliente AND NOT c.es_ocacional
      WHERE p.fecha_confirmado IS NOT NULL AND p.estado NOT IN ('abierto','cancelado')
      GROUP BY p.fk_idcliente
    ) first_sale WHERE primera >= $1::date AND primera < ($2::date + INTERVAL '1 day')`, dates),
    pool.query(`WITH moves AS (
      SELECT pg.fk_idforma_pago,pg.importe AS importe FROM pago pg
      WHERE pg.estado='aprobado' AND COALESCE(pg.pagado_at,pg.fecha_creado) >= $1::date
        AND COALESCE(pg.pagado_at,pg.fecha_creado) < ($2::date + INTERVAL '1 day')
      UNION ALL
      SELECT pg.fk_idforma_pago,-d.importe FROM devolucion_pago d JOIN pago pg ON pg.idpago=d.fk_idpago
      WHERE d.fecha_creado >= $1::date AND d.fecha_creado < ($2::date + INTERVAL '1 day')
    ) SELECT fp.nombre,count(*)::int AS movimientos,sum(m.importe) AS monto FROM moves m
      JOIN forma_pago fp ON fp.idforma_pago=m.fk_idforma_pago
      GROUP BY fp.idforma_pago,fp.nombre ORDER BY monto DESC`, dates),
    pool.query(`SELECT count(*)::int AS cantidad,COALESCE(sum(p.monto_total),0) AS monto FROM pedido p WHERE ${inRange} AND p.estado='cancelado'`, dates),
    detalle ? pool.query(`SELECT p.idpedido,to_char(p.fecha_confirmado,'YYYY-MM-DD') AS fecha,to_char(p.fecha_confirmado,'HH24:MI') AS hora,
      p.tipo_entrega,m.numero::text AS mesa,c.nombre_completo AS cliente,NULLIF(p.zona_nombre,'') AS zona,p.estado::text AS estado,
      p.monto_total AS monto,p.monto_descuento AS descuento,p.monto_recargo AS recargo,p.monto_delivery AS delivery,
      p.confirmado_por,p.motivo_anulado
      FROM pedido p LEFT JOIN mesa m ON m.idmesa=p.fk_idmesa LEFT JOIN cliente c ON c.idcliente=p.fk_idcliente
      WHERE ${inRange} AND p.estado<>'abierto' ORDER BY p.fecha_confirmado,p.idpedido`, dates) : Promise.resolve({ rows: [] })
  ]);
  const current = summary.rows.find(row => row.periodo === 'actual');
  const previous = summary.rows.find(row => row.periodo === 'anterior');
  const dias = numericRows(daily.rows, ['monto']);
  const semana = weekNames.map(nombre => ({ nombre, pedidos: 0, monto: 0 }));
  for (const day of dias) { const i = new Date(`${day.fecha}T12:00:00Z`).getUTCDay(); semana[i].pedidos += day.pedidos; semana[i].monto += day.monto; }
  return {
    inicio, fin,
    resumen: {
      pedidos: current.pedidos, monto: number(current.monto), ticket_promedio: current.pedidos ? number(current.monto) / current.pedidos : 0,
      clientes_nuevos: customers.rows[0].nuevos,
      anulados: { cantidad: cancelled.rows[0].cantidad, monto: number(cancelled.rows[0].monto) },
      anterior: { pedidos: previous.pedidos, monto: number(previous.monto) }
    },
    dias, semana,
    entregas: numericRows(deliveries.rows, ['monto']), mesas: numericRows(tables.rows, ['monto']),
    zonas: numericRows(zones.rows, ['monto']), productos: numericRows(products.rows, ['unidades', 'monto']),
    categorias: numericRows(categories.rows, ['unidades', 'monto']), grupos: numericRows(groups.rows, ['unidades', 'monto']),
    pagos: numericRows(payments.rows, ['monto']),
    lista: numericRows(list.rows, ['monto', 'descuento', 'recargo', 'delivery'])
  };
}
