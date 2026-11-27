import { pool } from '../config/database.js';
import { fail } from './pedidos.js';
import { leerConfigDefecto, validarComanda, validarPapel } from './impresora-config.js';

const COLUMNAS = `idterminal, equipo, nombre, nombre_impresora, impresora_factura, tamano_ticket, saltos_final, imprime_comanda, impresoras_detectadas,
  version_agente, activo, ultima_conexion, ultimo_usuario, fecha_modificado, modificado_por`;
const texto = (value, max) => String(value ?? '').trim().slice(0, max);

// La PC se identifica por el nombre de equipo que informa el agente. Una PC nueva toma el papel y la opción de comanda por defecto, sin impresora.
export async function registrarTerminal(body = {}, user) {
  const equipo = texto(body.equipo, 100).toUpperCase();
  if (!equipo) fail('El agente no informó el nombre de la PC');
  const impresoras = (Array.isArray(body.impresoras) ? body.impresoras : []).map(nombre => texto(nombre, 200)).filter(Boolean).slice(0, 100);
  const version = texto(body.version, 30) || null;
  const defecto = await leerConfigDefecto();
  const { rows } = await pool.query(`INSERT INTO terminal (equipo, nombre, tamano_ticket, saltos_final, impresoras_detectadas, version_agente,
      ultima_conexion, ultimo_usuario, creado_por, imprime_comanda)
    VALUES ($1, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $6, $7)
    ON CONFLICT (equipo) DO UPDATE SET impresoras_detectadas=EXCLUDED.impresoras_detectadas, version_agente=EXCLUDED.version_agente,
      ultima_conexion=CURRENT_TIMESTAMP, ultimo_usuario=EXCLUDED.ultimo_usuario
    RETURNING ${COLUMNAS}`, [equipo, defecto.tamano_ticket, defecto.saltos_final, impresoras, version, user.login, defecto.imprime_comanda]);
  return rows[0];
}

export async function listarTerminales() {
  return (await pool.query(`SELECT ${COLUMNAS} FROM terminal ORDER BY activo DESC, nombre`)).rows;
}

export async function guardarTerminal(id, body = {}, user) {
  const idterminal = Number(id);
  if (!Number.isSafeInteger(idterminal) || idterminal <= 0) fail('Terminal inválida');
  const nombre = texto(body.nombre, 60);
  if (!nombre) fail('Poné un nombre para la PC (por ejemplo, Caja 1)');
  const impresora = texto(body.nombre_impresora, 200) || null;
  // Impresora de la factura pre-impresa: si no viene en el pedido se conserva la guardada.
  const conFactura = body.impresora_factura !== undefined;
  const impresoraFactura = texto(body.impresora_factura, 200) || null;
  if (typeof body.activo !== 'boolean') fail('Indicá si la terminal está activa');
  const papel = validarPapel(body);
  const comanda = validarComanda(body);
  const { rows } = await pool.query(`UPDATE terminal SET nombre=$1, nombre_impresora=$2, tamano_ticket=$3, saltos_final=$4, activo=$5,
      fecha_modificado=CURRENT_TIMESTAMP, modificado_por=$6, imprime_comanda=COALESCE($8::boolean, imprime_comanda),
      impresora_factura=CASE WHEN $9::boolean THEN $10 ELSE impresora_factura END
      WHERE idterminal=$7 RETURNING ${COLUMNAS}`,
  [nombre, impresora, papel.tamano_ticket, papel.saltos_final, body.activo, user.login, idterminal, comanda, conFactura, impresoraFactura]);
  if (!rows.length) fail('Terminal no encontrada', 404);
  return rows[0];
}
