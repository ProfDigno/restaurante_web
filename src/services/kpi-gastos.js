import { pool } from '../config/database.js';

// Datos del Análisis de gastos para un rango de fechas: lo usan la pantalla, el PDF y el Excel.
export const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const validRange = (inicio, fin) => validDate(inicio) && validDate(fin) && inicio <= fin;
export const weekNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const numeric = (rows, fields) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fields.includes(key) ? Number(value || 0) : value])));

export async function kpiGastos(inicio, fin, { detalle = false } = {}) {
  const dates = [inicio, fin];
  const range = "g.fecha_gasto >= $1::date AND g.fecha_gasto < ($2::date + INTERVAL '1 day')";
  const [summary, daily, types, forms, top, list] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER (WHERE ${range} AND g.estado='pagado')::int AS cantidad,
      COALESCE(sum(g.total_gasto) FILTER (WHERE ${range} AND g.estado='pagado'),0) AS monto,
      count(*) FILTER (WHERE ${range} AND g.estado='anulado')::int AS anulados_cantidad,
      COALESCE(sum(g.total_gasto) FILTER (WHERE ${range} AND g.estado='anulado'),0) AS anulados_monto,
      count(*) FILTER (WHERE g.fecha_gasto >= ($1::date - (($2::date - $1::date) + 1)) AND g.fecha_gasto < $1::date AND g.estado='pagado')::int AS anterior_cantidad,
      COALESCE(sum(g.total_gasto) FILTER (WHERE g.fecha_gasto >= ($1::date - (($2::date - $1::date) + 1)) AND g.fecha_gasto < $1::date AND g.estado='pagado'),0) AS anterior_monto
      FROM gasto g`, dates),
    pool.query(`SELECT to_char(d.dia,'YYYY-MM-DD') AS fecha,count(g.idgasto)::int AS cantidad,
      COALESCE(sum(g.total_gasto),0) AS monto
      FROM generate_series($1::date,$2::date,INTERVAL '1 day') AS d(dia)
      LEFT JOIN gasto g ON g.fecha_gasto >= d.dia AND g.fecha_gasto < d.dia + INTERVAL '1 day' AND g.estado='pagado'
      GROUP BY d.dia ORDER BY d.dia`, dates),
    pool.query(`SELECT t.idgasto_tipo AS id,t.nombre,count(*)::int AS cantidad,sum(g.total_gasto) AS monto
      FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo
      WHERE ${range} AND g.estado='pagado' GROUP BY t.idgasto_tipo,t.nombre ORDER BY monto DESC`, dates),
    pool.query(`SELECT f.idforma_pago AS id,f.nombre,count(*)::int AS cantidad,sum(g.total_gasto) AS monto
      FROM gasto g JOIN forma_pago f ON f.idforma_pago=g.fk_idforma_pago
      WHERE ${range} AND g.estado='pagado' GROUP BY f.idforma_pago,f.nombre ORDER BY monto DESC`, dates),
    pool.query(`SELECT g.idgasto,to_char(g.fecha_gasto,'YYYY-MM-DD') AS fecha,t.nombre AS tipo,
      g.descripcion,g.total_gasto AS monto FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo
      WHERE ${range} AND g.estado='pagado' ORDER BY g.total_gasto DESC,g.idgasto DESC LIMIT 5`, dates),
    detalle ? pool.query(`SELECT g.idgasto,to_char(g.fecha_gasto,'YYYY-MM-DD') AS fecha,t.nombre AS tipo,f.nombre AS forma_pago,
      g.descripcion,g.total_gasto AS monto,g.estado::text AS estado,g.creado_por,g.motivo_anulado
      FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo JOIN forma_pago f ON f.idforma_pago=g.fk_idforma_pago
      WHERE ${range} ORDER BY g.fecha_gasto,g.idgasto`, dates) : Promise.resolve({ rows: [] })
  ]);
  const s = summary.rows[0];
  const dias = numeric(daily.rows, ['monto']);
  const semana = weekNames.map(nombre => ({ nombre, cantidad: 0, monto: 0 }));
  for (const day of dias) { const i = new Date(`${day.fecha}T12:00:00Z`).getUTCDay(); semana[i].cantidad += day.cantidad; semana[i].monto += day.monto; }
  return {
    inicio, fin,
    resumen: {
      cantidad: s.cantidad, monto: Number(s.monto), promedio: s.cantidad ? Number(s.monto) / s.cantidad : 0,
      anulados: { cantidad: s.anulados_cantidad, monto: Number(s.anulados_monto) },
      anterior: { cantidad: s.anterior_cantidad, monto: Number(s.anterior_monto) }
    },
    dias, semana,
    tipos: numeric(types.rows, ['monto']), formas: numeric(forms.rows, ['monto']), mayores: numeric(top.rows, ['monto']),
    gastos: numeric(list.rows, ['monto'])
  };
}

export { change, isoToText } from './report-pdf.js';
