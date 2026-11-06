import { pool } from '../config/database.js';
import { weekNames } from './kpi-gastos.js';

// Datos del Análisis de compras para un rango de fechas (por fecha de compra).
// Suman solo las compras recibidas; borradores y canceladas se informan aparte.
const numeric = (rows, fields) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fields.includes(key) ? Number(value || 0) : value])));

// proveedor (opcional): id de proveedor; filtra todos los indicadores, gráficos y el detalle.
export async function kpiCompras(inicio, fin, { detalle = false, proveedor = null } = {}) {
  const dates = [inicio, fin, proveedor];
  const bySupplier = '($3::int IS NULL OR c.fk_idproveedor=$3::int)';
  const range = `c.fecha_compra >= $1::date AND c.fecha_compra < ($2::date + INTERVAL '1 day') AND ${bySupplier}`;
  const previous = `c.fecha_compra >= ($1::date - (($2::date - $1::date) + 1)) AND c.fecha_compra < $1::date AND ${bySupplier}`;
  const borradorTotal = '(SELECT COALESCE(sum(d.cantidad*d.precio_compra),0) FROM detalle_compra_producto d WHERE d.fk_idcompra=c.idcompra)';
  const [summary, daily, suppliers, conditions, forms, products, list] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER (WHERE ${range} AND c.estado='recibida')::int AS cantidad,
      COALESCE(sum(c.total) FILTER (WHERE ${range} AND c.estado='recibida'),0) AS monto,
      COALESCE(sum(c.importe_pagado) FILTER (WHERE ${range} AND c.estado='recibida'),0) AS pagado,
      count(*) FILTER (WHERE ${range} AND c.estado='recibida' AND c.total > c.importe_pagado)::int AS pendientes_cantidad,
      count(*) FILTER (WHERE ${range} AND c.estado='cancelada')::int AS canceladas_cantidad,
      COALESCE(sum(c.total) FILTER (WHERE ${range} AND c.estado='cancelada'),0) AS canceladas_monto,
      count(*) FILTER (WHERE ${range} AND c.estado='borrador')::int AS borradores_cantidad,
      COALESCE(sum(${borradorTotal}) FILTER (WHERE ${range} AND c.estado='borrador'),0) AS borradores_monto,
      count(*) FILTER (WHERE ${previous} AND c.estado='recibida')::int AS anterior_cantidad,
      COALESCE(sum(c.total) FILTER (WHERE ${previous} AND c.estado='recibida'),0) AS anterior_monto
      FROM compra c`, dates),
    pool.query(`SELECT to_char(d.dia,'YYYY-MM-DD') AS fecha,count(c.idcompra)::int AS cantidad,COALESCE(sum(c.total),0) AS monto
      FROM generate_series($1::date,$2::date,INTERVAL '1 day') AS d(dia)
      LEFT JOIN compra c ON c.fecha_compra >= d.dia AND c.fecha_compra < d.dia + INTERVAL '1 day' AND c.estado='recibida' AND ${bySupplier}
      GROUP BY d.dia ORDER BY d.dia`, dates),
    pool.query(`SELECT p.idproveedor AS id,p.nombre,count(*)::int AS cantidad,sum(c.total) AS monto,sum(c.total-c.importe_pagado) AS saldo
      FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor
      WHERE ${range} AND c.estado='recibida' GROUP BY p.idproveedor,p.nombre ORDER BY monto DESC,p.nombre`, dates),
    pool.query(`SELECT c.condicion AS id,initcap(lower(c.condicion)) AS nombre,count(*)::int AS cantidad,sum(c.total) AS monto,sum(c.total-c.importe_pagado) AS saldo
      FROM compra c WHERE ${range} AND c.estado='recibida' GROUP BY c.condicion ORDER BY monto DESC`, dates),
    pool.query(`SELECT f.idforma_pago AS id,f.nombre,count(*)::int AS cantidad,sum(cp.importe) AS monto
      FROM compra_pago cp JOIN compra c ON c.idcompra=cp.fk_idcompra JOIN forma_pago f ON f.idforma_pago=cp.fk_idforma_pago
      WHERE ${range} AND c.estado='recibida' AND cp.estado='aprobado' GROUP BY f.idforma_pago,f.nombre ORDER BY monto DESC`, dates),
    pool.query(`SELECT pm.idproducto_menu AS id,pm.nombre || ' · ' || um.nombre AS nombre,sum(d.cantidad)::numeric AS unidades,count(DISTINCT c.idcompra)::int AS cantidad,
      sum(d.cantidad*d.precio_compra) AS monto
      FROM detalle_compra_producto d JOIN compra c ON c.idcompra=d.fk_idcompra
      JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
      WHERE ${range} AND c.estado='recibida' GROUP BY pm.idproducto_menu,pm.nombre,um.nombre ORDER BY monto DESC,pm.nombre LIMIT 10`, dates),
    detalle ? pool.query(`SELECT c.idcompra,to_char(c.fecha_compra,'YYYY-MM-DD') AS fecha,p.nombre AS proveedor,c.numero_nota,c.condicion,
      c.estado::text AS estado,c.estado_pago::text AS estado_pago,
      CASE WHEN c.estado='borrador' THEN ${borradorTotal} ELSE c.total END AS monto,
      CASE WHEN c.estado='recibida' THEN c.importe_pagado ELSE 0 END AS pagado,
      CASE WHEN c.estado='recibida' THEN c.total-c.importe_pagado ELSE 0 END AS saldo,
      (SELECT count(*) FROM detalle_compra_producto d WHERE d.fk_idcompra=c.idcompra)::int AS productos,
      c.creado_por,c.motivo_anulado
      FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor
      WHERE ${range} ORDER BY c.fecha_compra,c.idcompra`, dates) : Promise.resolve({ rows: [] })
  ]);
  const s = summary.rows[0];
  const filtro = proveedor ? (await pool.query('SELECT nombre FROM proveedor WHERE idproveedor=$1', [proveedor])).rows[0]?.nombre || null : null;
  const monto = Number(s.monto), pagado = Number(s.pagado);
  const dias = numeric(daily.rows, ['monto']);
  const semana = weekNames.map(nombre => ({ nombre, cantidad: 0, monto: 0 }));
  for (const day of dias) { const i = new Date(`${day.fecha}T12:00:00Z`).getUTCDay(); semana[i].cantidad += day.cantidad; semana[i].monto += day.monto; }
  return {
    inicio, fin, filtro: filtro ? `Proveedor: ${filtro}` : null,
    resumen: {
      cantidad: s.cantidad, monto, promedio: s.cantidad ? monto / s.cantidad : 0, pagado, saldo: monto - pagado,
      pendientes: s.pendientes_cantidad,
      canceladas: { cantidad: s.canceladas_cantidad, monto: Number(s.canceladas_monto) },
      borradores: { cantidad: s.borradores_cantidad, monto: Number(s.borradores_monto) },
      anterior: { cantidad: s.anterior_cantidad, monto: Number(s.anterior_monto) }
    },
    dias, semana,
    proveedores: numeric(suppliers.rows, ['monto', 'saldo']),
    condiciones: numeric(conditions.rows, ['monto', 'saldo']),
    formas: numeric(forms.rows, ['monto']),
    productos: numeric(products.rows, ['monto', 'unidades']),
    compras: numeric(list.rows, ['monto', 'pagado', 'saldo'])
  };
}

// Opciones del filtro: proveedores activos y los inactivos que tienen compras.
export async function kpiComprasOpciones() {
  return { proveedores: (await pool.query(`SELECT p.idproveedor AS id,p.nombre,p.activo FROM proveedor p
    WHERE p.activo OR EXISTS (SELECT 1 FROM compra c WHERE c.fk_idproveedor=p.idproveedor) ORDER BY p.nombre`)).rows };
}
