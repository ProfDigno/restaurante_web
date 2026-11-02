import { pool } from '../config/database.js';
import { fail } from './pedidos.js';

// Valores usados si la configuración todavía no existe (por ejemplo, antes de migrar).
export const COMANDA_CONFIG_DEFECTO = {
  limite_terminado_min: 60, pase_automatico: true, anulado_visible_seg: 30, refresco_seg: 3, chequeo_limite_seg: 15,
  colores: [
    { desde_minuto: 0, color: '#ffffff' }, { desde_minuto: 10, color: '#fff09a' }, { desde_minuto: 20, color: '#ffc287' },
    { desde_minuto: 30, color: '#c8ced1' }, { desde_minuto: 40, color: '#a8d6f4' }, { desde_minuto: 50, color: '#ffb3b3' }
  ]
};

export async function leerConfigComanda(c = pool) {
  const config = (await c.query('SELECT * FROM comanda_config WHERE idcomanda_config=1')).rows[0];
  if (!config) return COMANDA_CONFIG_DEFECTO;
  const colores = (await c.query('SELECT idcomanda_color, desde_minuto, color FROM comanda_color ORDER BY desde_minuto')).rows;
  return { ...config, colores: colores.length ? colores : COMANDA_CONFIG_DEFECTO.colores };
}

const entero = (value, label, min, max) => {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < min || n > max) fail(`${label}: ingresá un entero entre ${min} y ${max}`);
  return n;
};

export function validarConfigComanda(body = {}) {
  if (typeof body.pase_automatico !== 'boolean') fail('Indicá si el pase automático está activo');
  const colores = body.colores;
  if (!Array.isArray(colores) || colores.length < 1 || colores.length > 20) fail('Definí entre 1 y 20 tramos de color');
  const tramos = colores.map(item => {
    const color = String(item?.color || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) fail('Cada color debe tener el formato #rrggbb');
    return { desde_minuto: entero(item?.desde_minuto, 'Minuto del tramo', 0, 1440), color };
  }).sort((a, b) => a.desde_minuto - b.desde_minuto);
  if (tramos[0].desde_minuto !== 0) fail('El primer tramo debe empezar en el minuto 0');
  if (new Set(tramos.map(tramo => tramo.desde_minuto)).size !== tramos.length) fail('Dos tramos no pueden empezar en el mismo minuto');
  return {
    limite_terminado_min: entero(body.limite_terminado_min, 'Límite máximo (minutos)', 1, 1440),
    pase_automatico: body.pase_automatico,
    anulado_visible_seg: entero(body.anulado_visible_seg, 'Segundos que se ve un pedido anulado', 5, 600),
    refresco_seg: entero(body.refresco_seg, 'Refresco de la pantalla (segundos)', 1, 60),
    chequeo_limite_seg: entero(body.chequeo_limite_seg, 'Revisión del límite (segundos)', 5, 300),
    colores: tramos
  };
}

export async function guardarConfigComanda(body, user) {
  const data = validarConfigComanda(body);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`INSERT INTO comanda_config (idcomanda_config) VALUES (1) ON CONFLICT DO NOTHING`);
    await c.query(`UPDATE comanda_config SET limite_terminado_min=$1, pase_automatico=$2, anulado_visible_seg=$3, refresco_seg=$4,
      chequeo_limite_seg=$5, fecha_modificado=CURRENT_TIMESTAMP, modificado_por=$6 WHERE idcomanda_config=1`,
    [data.limite_terminado_min, data.pase_automatico, data.anulado_visible_seg, data.refresco_seg, data.chequeo_limite_seg, user.login]);
    await c.query('DELETE FROM comanda_color');
    for (const tramo of data.colores) {
      await c.query('INSERT INTO comanda_color (desde_minuto, color, creado_por) VALUES ($1, $2, $3)', [tramo.desde_minuto, tramo.color, user.login]);
    }
    await c.query('COMMIT');
  } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  return leerConfigComanda();
}
