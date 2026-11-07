import { pool } from '../config/database.js';
import { weekNames } from './kpi-gastos.js';

// Datos del Análisis de vales (RR.HH.) para un rango de fechas: lo usan la pantalla, el PDF y el Excel.
// Suman los vales pagados por fecha del vale; los anulados se informan aparte y los pendientes no suman.
// "Sueldo del período" es una aproximación por días corridos según el tipo de pago de cada persona
// (diario × días, semanal ÷ 7, quincenal ÷ 15, mensual ÷ 30), para ver qué parte del sueldo se adelantó en vales.
const DIAS_POR_PAGO = { DIARIO: 1, SEMANAL: 7, QUINCENAL: 15, MENSUAL: 30 };
const numeric = (rows, fields) => rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fields.includes(key) ? Number(value || 0) : value])));
const dayCount = (inicio, fin) => Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000) + 1;
export const sueldoDelPeriodo = (montoPago, tipoPago, dias) => montoPago > 0 && DIAS_POR_PAGO[tipoPago] ? Math.round(montoPago / DIAS_POR_PAGO[tipoPago] * dias) : 0;

// personal (opcional): id de personal; filtra indicadores, gráficos y detalle.
export async function kpiVales(inicio, fin, { detalle = false, personal = null } = {}) {
  const params = [inicio, fin, personal];
  const byPerson = '($3::int IS NULL OR v.fk_idpersonal=$3::int)';
  const range = `v.fecha_vale >= $1::date AND v.fecha_vale < ($2::date + INTERVAL '1 day') AND ${byPerson}`;
  const previous = `v.fecha_vale >= ($1::date - (($2::date - $1::date) + 1)) AND v.fecha_vale < $1::date AND ${byPerson}`;
  const [summary, daily, people, forms, roles, list] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER (WHERE ${range} AND v.estado='pagado')::int AS cantidad,
      COALESCE(sum(v.monto_vale) FILTER (WHERE ${range} AND v.estado='pagado'),0) AS monto,
      count(DISTINCT v.fk_idpersonal) FILTER (WHERE ${range} AND v.estado='pagado')::int AS personas,
      count(*) FILTER (WHERE ${range} AND v.estado='anulado')::int AS anulados_cantidad,
      COALESCE(sum(v.monto_vale) FILTER (WHERE ${range} AND v.estado='anulado'),0) AS anulados_monto,
      count(*) FILTER (WHERE ${previous} AND v.estado='pagado')::int AS anterior_cantidad,
      COALESCE(sum(v.monto_vale) FILTER (WHERE ${previous} AND v.estado='pagado'),0) AS anterior_monto
      FROM vale v`, params),
    pool.query(`SELECT to_char(d.dia,'YYYY-MM-DD') AS fecha,count(v.idvale)::int AS cantidad,COALESCE(sum(v.monto_vale),0) AS monto
      FROM generate_series($1::date,$2::date,INTERVAL '1 day') AS d(dia)
      LEFT JOIN vale v ON v.fecha_vale >= d.dia AND v.fecha_vale < d.dia + INTERVAL '1 day' AND v.estado='pagado' AND ${byPerson}
      GROUP BY d.dia ORDER BY d.dia`, params),
    pool.query(`SELECT p.idpersonal AS id,p.nombre_completo AS nombre,p.cargo,p.activo,p.tipo_pago,p.monto_pago,p.limite_monto_vale,
      count(*)::int AS cantidad,sum(v.monto_vale) AS monto,max(v.monto_vale) AS mayor,to_char(max(v.fecha_vale),'YYYY-MM-DD') AS ultimo
      FROM vale v JOIN personal p ON p.idpersonal=v.fk_idpersonal
      WHERE ${range} AND v.estado='pagado' GROUP BY p.idpersonal ORDER BY monto DESC,p.nombre_completo`, params),
    pool.query(`SELECT f.idforma_pago AS id,f.nombre,count(*)::int AS cantidad,sum(v.monto_vale) AS monto
      FROM vale v JOIN forma_pago f ON f.idforma_pago=v.fk_idforma_pago
      WHERE ${range} AND v.estado='pagado' GROUP BY f.idforma_pago,f.nombre ORDER BY monto DESC`, params),
    pool.query(`SELECT COALESCE(NULLIF(trim(p.cargo),''),'Sin cargo') AS nombre,count(*)::int AS cantidad,sum(v.monto_vale) AS monto
      FROM vale v JOIN personal p ON p.idpersonal=v.fk_idpersonal
      WHERE ${range} AND v.estado='pagado' GROUP BY 1 ORDER BY monto DESC`, params),
    detalle ? pool.query(`SELECT v.idvale,to_char(v.fecha_vale,'YYYY-MM-DD') AS fecha,p.nombre_completo AS personal,p.cargo,
      f.nombre AS forma_pago,v.descripcion,v.monto_vale AS monto,v.estado::text AS estado,v.creado_por,v.motivo_anulado
      FROM vale v JOIN personal p ON p.idpersonal=v.fk_idpersonal JOIN forma_pago f ON f.idforma_pago=v.fk_idforma_pago
      WHERE ${range} AND v.estado IN ('pagado','anulado') ORDER BY v.fecha_vale,v.idvale`, params) : Promise.resolve({ rows: [] })
  ]);
  const s = summary.rows[0];
  const dias = numeric(daily.rows, ['monto']);
  const semana = weekNames.map(nombre => ({ nombre, cantidad: 0, monto: 0 }));
  for (const day of dias) { const i = new Date(`${day.fecha}T12:00:00Z`).getUTCDay(); semana[i].cantidad += day.cantidad; semana[i].monto += day.monto; }
  const periodDays = dayCount(inicio, fin);
  const personas = numeric(people.rows, ['monto', 'mayor', 'monto_pago', 'limite_monto_vale']).map(p => {
    const sueldo = sueldoDelPeriodo(p.monto_pago, p.tipo_pago, periodDays);
    return { ...p, promedio: p.cantidad ? p.monto / p.cantidad : 0, sueldo_periodo: sueldo, pct_sueldo: sueldo ? p.monto / sueldo * 100 : null };
  });
  const conSueldo = personas.filter(p => p.sueldo_periodo > 0);
  const sueldoTotal = conSueldo.reduce((sum, p) => sum + p.sueldo_periodo, 0);
  const valesConSueldo = conSueldo.reduce((sum, p) => sum + p.monto, 0);
  const filtro = personal ? (await pool.query('SELECT nombre_completo FROM personal WHERE idpersonal=$1', [personal])).rows[0]?.nombre_completo || null : null;
  return {
    inicio, fin, dias_periodo: periodDays, filtro: filtro ? `Personal: ${filtro}` : null,
    resumen: {
      cantidad: s.cantidad, monto: Number(s.monto), promedio: s.cantidad ? Number(s.monto) / s.cantidad : 0, personas: s.personas,
      // Parte del sueldo del período que se adelantó en vales (solo personas con sueldo cargado).
      sueldo_periodo: sueldoTotal, pct_sueldo: sueldoTotal ? valesConSueldo / sueldoTotal * 100 : null,
      anulados: { cantidad: s.anulados_cantidad, monto: Number(s.anulados_monto) },
      anterior: { cantidad: s.anterior_cantidad, monto: Number(s.anterior_monto) }
    },
    dias, semana, personas,
    formas: numeric(forms.rows, ['monto']), cargos: numeric(roles.rows, ['monto']),
    vales: numeric(list.rows, ['monto'])
  };
}

// Opciones del filtro: todo el personal (también inactivo, para consultar períodos pasados).
export async function kpiValesOpciones() {
  return { personal: (await pool.query('SELECT idpersonal AS id,nombre_completo AS nombre,cargo,activo FROM personal ORDER BY activo DESC,nombre_completo')).rows };
}
