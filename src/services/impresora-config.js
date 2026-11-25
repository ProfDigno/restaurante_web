import { AsyncLocalStorage } from 'node:async_hooks';
import { pool } from '../config/database.js';
import { fail } from './pedidos.js';

// Valores usados si la configuración todavía no existe (por ejemplo, antes de migrar).
export const IMPRESORA_CONFIG_DEFECTO = { tamano_ticket: 80, saltos_final: 5, imprime_comanda: false };

// Terminal (PC) desde la que llega el pedido: la fija el middleware `contextoTerminal` con ?terminal= o X-Terminal,
// así cada ticket sale con el papel de esa PC sin tener que pasarlo por todas las rutas.
const contexto = new AsyncLocalStorage();
export function contextoTerminal(req, res, next) {
  const id = Number(req.query?.terminal ?? req.get('X-Terminal'));
  if (!Number.isSafeInteger(id) || id <= 0) return next();
  contexto.run({ terminal: id }, next);
}

// Valores por defecto: para PCs nuevas y para las que no tienen agente de impresión.
export async function leerConfigDefecto(c = pool) {
  // Con *: si faltara una columna nueva (base sin migrar) el catch perdería también el papel configurado.
  const config = (await c.query('SELECT * FROM impresora_config WHERE idimpresora_config=1').catch(() => ({ rows: [] }))).rows[0];
  return { ...IMPRESORA_CONFIG_DEFECTO, ...config };
}

// Papel del ticket y opción de comanda: los de la terminal del pedido actual (si está activa) o el de por defecto.
export async function leerConfigImpresora(c = pool) {
  const terminal = contexto.getStore()?.terminal;
  if (terminal) {
    const row = (await c.query('SELECT * FROM terminal WHERE idterminal=$1 AND activo', [terminal]).catch(() => ({ rows: [] }))).rows[0];
    if (row) return row;
  }
  return leerConfigDefecto(c);
}

export function validarPapel(body = {}) {
  const tamano = Number(body.tamano_ticket);
  if (![58, 80].includes(tamano)) fail('Elegí un tamaño de ticket: 58 mm u 80 mm');
  const saltos = Number(body.saltos_final);
  if (body.saltos_final === '' || body.saltos_final === null || body.saltos_final === undefined || !Number.isInteger(saltos) || saltos < 0 || saltos > 30) {
    fail('Saltos de línea al final: ingresá un entero entre 0 y 30');
  }
  return { tamano_ticket: tamano, saltos_final: saltos };
}

// "Imprimir comanda detrás del pedido". Si no viene, se conserva lo guardado (null).
export function validarComanda(body = {}) {
  const valor = body.imprime_comanda;
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'boolean') fail('Indicá si se imprime la comanda');
  return valor;
}

export async function guardarConfigDefecto(body, user) {
  const data = validarPapel(body);
  const comanda = validarComanda(body);
  await pool.query('INSERT INTO impresora_config (idimpresora_config) VALUES (1) ON CONFLICT DO NOTHING');
  await pool.query(`UPDATE impresora_config SET tamano_ticket=$1, saltos_final=$2, imprime_comanda=COALESCE($3::boolean, imprime_comanda),
    fecha_modificado=CURRENT_TIMESTAMP, modificado_por=$4 WHERE idimpresora_config=1`,
  [data.tamano_ticket, data.saltos_final, comanda, user.login]);
  return leerConfigDefecto();
}
