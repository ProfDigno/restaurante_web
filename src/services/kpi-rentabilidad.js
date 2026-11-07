import { pool } from '../config/database.js';

// Análisis de rentabilidad por producto y categoría. Lo usan la pantalla, el PDF y el Excel.
// Cuenta los mismos pedidos que el Análisis de pedidos: por fecha de confirmación, sin abiertos ni anulados,
// y sin líneas anuladas.
//   Venta  = cantidad × (precio de venta + precio de la observación) + ingredientes agregados cobrados.
//   Costo  = cantidad × costo guardado al vender (precio de compra del producto, o su receta si la tiene)
//            + ingredientes agregados × su costo. Si una receta o un agregado se vendió antes de guardar
//            el costo, se usa el precio actual del ingrediente y la línea queda marcada como "estimado".
// Producto "sin costo": ninguna venta tuvo costo. "Costo incompleto": algunas ventas sí y otras no
// (por ejemplo, vendidas antes de cargar el precio de compra).
// Los descuentos son del pedido entero: se restan solo en el resumen (margen neto), no por producto.
const number = value => Number(value || 0);
const pct = (margen, venta) => venta ? margen / venta * 100 : 0;
const sales = (from, to) => `p.fecha_confirmado >= ${from}::date AND p.fecha_confirmado < (${to}::date + INTERVAL '1 day') AND p.estado NOT IN ('abierto','cancelado')`;

const lines = (range, category) => `
  SELECT dp.fk_idproducto_menu, dp.cantidad, p.idpedido,
    dp.cantidad * (dp.precio_venta + dp.precio_observacion) + dp.cantidad * COALESCE(ag.venta, 0) AS venta,
    CASE WHEN dp.usa_receta_stock THEN dp.cantidad * COALESCE(rc.costo, 0) ELSE dp.cantidad * dp.precio_compra END
      + dp.cantidad * COALESCE(ag.costo, 0) AS costo,
    (dp.usa_receta_stock AND COALESCE(rc.estimado, false)) OR COALESCE(ag.estimado, false) AS estimado,
    CASE WHEN dp.usa_receta_stock THEN COALESCE(rc.costo, 0) ELSE dp.precio_compra END = 0 AS sin_costo
  FROM pedido p
  JOIN detalle_pedido dp ON dp.fk_idpedido = p.idpedido AND dp.estado <> 'cancelado'
  JOIN producto_menu pm ON pm.idproducto_menu = dp.fk_idproducto_menu
  LEFT JOIN LATERAL (
    SELECT sum(dpr.cantidad_base * COALESCE(dpr.costo_unitario, i.precio_compra)) AS costo, bool_or(dpr.costo_unitario IS NULL) AS estimado
    FROM detalle_pedido_receta dpr JOIN ingrediente i ON i.idingrediente = dpr.fk_idingrediente
    WHERE dpr.fk_iddetalle_pedido = dp.iddetalle_pedido
  ) rc ON true
  LEFT JOIN LATERAL (
    SELECT sum(dpi.precio_venta) AS venta, sum(dpi.cantidad * COALESCE(dpi.costo_unitario, i.precio_compra)) AS costo,
      bool_or(dpi.costo_unitario IS NULL) AS estimado
    FROM detalle_pedido_ingrediente dpi JOIN ingrediente i ON i.idingrediente = dpi.fk_idingrediente
    WHERE dpi.fk_iddetalle_pedido = dp.iddetalle_pedido AND dpi.activo AND dpi.tipo_modificacion = 'AGREGAR'
  ) ag ON true
  WHERE ${range}${category ? ' AND pm.fk_idcategoria_menu = $3' : ''}`;

// Costo menor al 1% de la venta: casi seguro un valor de relleno (p. ej. precio de compra 1 Gs.), no un costo real.
export const COSTO_SOSPECHOSO = 0.01;
const withMargin = row => {
  const venta = number(row.venta), costo = number(row.costo), margen = venta - costo;
  return { ...row, unidades: number(row.unidades), venta, costo, margen, margen_pct: pct(margen, venta),
    costo_sospechoso: !row.sin_costo && venta > 0 && costo > 0 && costo < venta * COSTO_SOSPECHOSO };
};

export async function kpiRentabilidad(inicio, fin, { categoria = null } = {}) {
  const params = categoria ? [inicio, fin, categoria] : [inicio, fin];
  const current = lines(sales('$1', '$2'), categoria);
  const previous = lines(`p.fecha_confirmado >= ($1::date - (($2::date - $1::date) + 1)) AND p.fecha_confirmado < $1::date AND p.estado NOT IN ('abierto','cancelado')`, categoria);
  const [productos, categorias, resumen, anterior, descuentos, filtro] = await Promise.all([
    pool.query(`WITH l AS (${current})
      SELECT pm.idproducto_menu AS id, pm.nombre, cm.nombre AS categoria, um.nombre AS unidad,
        sum(l.cantidad) AS unidades, sum(l.venta) AS venta, sum(l.costo) AS costo,
        bool_and(l.sin_costo) AS sin_costo, bool_or(l.sin_costo) AND NOT bool_and(l.sin_costo) AS costo_incompleto, bool_or(l.estimado) AS estimado
      FROM l JOIN producto_menu pm ON pm.idproducto_menu = l.fk_idproducto_menu
      JOIN categoria_menu cm ON cm.idcategoria_menu = pm.fk_idcategoria_menu
      JOIN unidad_menu um ON um.idunidad_menu = pm.fk_idunidad_menu
      GROUP BY pm.idproducto_menu, pm.nombre, cm.nombre, um.nombre`, params),
    pool.query(`WITH l AS (${current})
      SELECT cm.idcategoria_menu AS id, cm.nombre, sum(l.cantidad) AS unidades, sum(l.venta) AS venta, sum(l.costo) AS costo,
        count(DISTINCT l.fk_idproducto_menu) FILTER (WHERE l.sin_costo)::int AS productos_sin_costo
      FROM l JOIN producto_menu pm ON pm.idproducto_menu = l.fk_idproducto_menu
      JOIN categoria_menu cm ON cm.idcategoria_menu = pm.fk_idcategoria_menu
      GROUP BY cm.idcategoria_menu, cm.nombre`, params),
    pool.query(`WITH l AS (${current})
      SELECT count(DISTINCT l.idpedido)::int AS pedidos, COALESCE(sum(l.cantidad), 0) AS unidades,
        COALESCE(sum(l.venta), 0) AS venta, COALESCE(sum(l.costo), 0) AS costo,
        COALESCE(sum(l.venta) FILTER (WHERE l.sin_costo), 0) AS venta_sin_costo,
        count(DISTINCT l.fk_idproducto_menu) FILTER (WHERE l.sin_costo)::int AS productos_sin_costo,
        count(*) FILTER (WHERE l.estimado)::int AS lineas_estimadas
      FROM l`, params),
    pool.query(`WITH l AS (${previous}) SELECT COALESCE(sum(l.venta), 0) AS venta, COALESCE(sum(l.costo), 0) AS costo FROM l`, params),
    categoria ? Promise.resolve({ rows: [{ monto: 0 }] })
      : pool.query(`SELECT COALESCE(sum(p.monto_descuento), 0) AS monto FROM pedido p WHERE ${sales('$1', '$2')}`, [inicio, fin]),
    categoria ? pool.query('SELECT nombre FROM categoria_menu WHERE idcategoria_menu = $1', [categoria]) : Promise.resolve({ rows: [] })
  ]);
  const r = resumen.rows[0];
  const venta = number(r.venta), costo = number(r.costo), margen = venta - costo, descuento = number(descuentos.rows[0].monto);
  const prev = anterior.rows[0], prevMargen = number(prev.venta) - number(prev.costo);
  // Hay productos con el mismo nombre en distintas categorías y unidades: la etiqueta es "categoría · unidad · producto", como en el Análisis de pedidos.
  const lista = productos.rows.map(row => ({ ...withMargin(row), etiqueta: `${row.categoria} · ${row.unidad} · ${row.nombre}` })).sort((a, b) => b.margen - a.margen || b.venta - a.venta);
  const perdida = lista.filter(p => p.margen < 0);
  const sospechosos = lista.filter(p => p.costo_sospechoso);
  return {
    inicio, fin,
    filtro: categoria ? `Categoría: ${filtro.rows[0]?.nombre || `#${categoria}`}` : null,
    resumen: {
      pedidos: r.pedidos, unidades: number(r.unidades), venta, costo, margen, margen_pct: pct(margen, venta),
      // Con filtro de categoría no se restan descuentos: son del pedido entero y no se pueden repartir con certeza.
      descuentos: categoria ? null : descuento,
      margen_neto: categoria ? null : margen - descuento,
      venta_sin_costo: number(r.venta_sin_costo), productos_sin_costo: r.productos_sin_costo, lineas_estimadas: r.lineas_estimadas,
      // Vendidos por debajo del costo en el período.
      productos_con_perdida: perdida.length, perdida: perdida.reduce((sum, p) => sum + p.margen, 0),
      productos_costo_sospechoso: sospechosos.length, venta_costo_sospechoso: sospechosos.reduce((sum, p) => sum + p.venta, 0),
      anterior: { venta: number(prev.venta), costo: number(prev.costo), margen: prevMargen, margen_pct: pct(prevMargen, number(prev.venta)) }
    },
    productos: lista,
    categorias: categorias.rows.map(withMargin).sort((a, b) => b.margen - a.margen)
  };
}

export async function kpiRentabilidadOpciones() {
  const { rows } = await pool.query('SELECT idcategoria_menu AS id, nombre, activa AS activo FROM categoria_menu ORDER BY activa DESC, nombre');
  return { categorias: rows };
}
