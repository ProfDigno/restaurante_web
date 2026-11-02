import { pool } from '../config/database.js';
import { fail } from './pedidos.js';

// Cliente de la API REST de SISFE (https://sisfe.com.py/documentacion.html).
// La URL, el tenant y la API Key se guardan en datos_restaurante y nunca salen al navegador.
const TIMEOUT_MS = 30000;

export async function datosRestaurante(c = pool) {
  return (await c.query('SELECT * FROM datos_restaurante WHERE iddatos_restaurante=1')).rows[0];
}

function endpoint(cfg) {
  if (!cfg?.sisfe_url || !cfg.sisfe_tenant || !cfg.sisfe_api_key) fail('Configurá la conexión con SISFE en Datos de restaurante', 409);
  return `${cfg.sisfe_url.replace(/\/+$/, '')}/api/${encodeURIComponent(cfg.sisfe_tenant)}`;
}

async function request(method, path, { body, query, cfg } = {}) {
  cfg ||= await datosRestaurante();
  const url = new URL(`${endpoint(cfg)}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  const key = cfg.sisfe_api_key.startsWith('api_key_') ? cfg.sisfe_api_key : `api_key_${cfg.sisfe_api_key}`;
  try {
    return await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') fail('SISFE no respondió a tiempo. Intentá de nuevo', 504);
    fail('No se pudo conectar con SISFE. Revisá la URL y la conexión', 502);
  }
}

async function json(response) {
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { fail(`SISFE devolvió una respuesta inesperada (HTTP ${response.status})`, 502); }
  if (response.status === 401 || response.status === 403) fail('SISFE rechazó la API Key o el tenant configurados', 502);
  if (!response.ok) fail(data.message || data.error || `SISFE respondió HTTP ${response.status}`, 502);
  return data;
}

const failure = (data, fallback) => data.message || data.error || (typeof data.result === 'string' ? data.result : null) || fallback;

export async function probarConexion(cfg) {
  const data = await json(await request('GET', '/test', { cfg }));
  if (!data.success) fail(failure(data, 'SISFE no confirmó la conexión'), 502);
  return { mensaje: data.message, ...data.data };
}

// El RUC se consulta sin dígito verificador.
export async function consultarRuc(ruc) {
  const data = await json(await request('GET', `/ruc/${encodeURIComponent(ruc)}`));
  if (!data.success) fail(failure(data, 'No se pudo consultar el RUC'), 502);
  const response = data.data?.['ns2:rResEnviConsRUC'] || {};
  const code = response['ns2:dCodRes'];
  const found = response['ns2:xContRUC'];
  if (code === '0500' || !found) return { encontrado: false, mensaje: response['ns2:dMsgRes'] || 'RUC no existe' };
  return {
    encontrado: true,
    ruc: found['ns2:dRUCCons'],
    razon_social: found['ns2:dRazCons'],
    estado: found['ns2:dDesEstCons'],
    activo: found['ns2:dCodEstCons'] === 'ACT',
    facturador_electronico: found['ns2:dRUCFactElec'] === 'S'
  };
}

// Devuelve el primer documento de la respuesta de un lote (crear, confirmar o consultar estado).
function firstDocument(data) {
  if (!data.success) fail(failure(data, 'SISFE rechazó el documento'), 502);
  const document = data.result?.deList?.[0];
  if (!document) fail('SISFE no devolvió el documento', 502);
  return document;
}

export async function crearLote(documento, { borrador = true } = {}) {
  const data = await json(await request('POST', '/lote/create', { body: [documento], query: borrador ? { draft: 't' } : {} }));
  return firstDocument(data);
}

export async function confirmarBorrador(loteId) {
  return firstDocument(await json(await request('POST', `/lote/draft-confirm/${encodeURIComponent(loteId)}`)));
}

export async function consultarEstado(cdc) {
  return firstDocument(await json(await request('POST', '/de/estado', { body: { cdcList: [{ cdc }] } })));
}

export async function descargarKude(cdc) {
  const response = await request('POST', '/de/pdf', { body: { cdcList: [{ cdc }] } });
  if (!(response.headers.get('content-type') || '').includes('application/pdf')) {
    fail(failure(await json(response), 'SISFE no pudo generar el PDF'), 502);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function cancelarDocumento(cdc, motivo) {
  const data = await json(await request('POST', '/evento/cancelacion', { body: { cdc, motivo } }));
  if (!data.success) fail(failure(data, 'SISFE no pudo cancelar el documento'), 502);
  const result = data.data?.['ns2:rRetEnviEventoDe']?.['ns2:gResProcEVe']?.['ns2:gResProc'] || {};
  if (result['ns2:dCodRes'] !== '0600') fail(`SISFE no registró la cancelación: ${result['ns2:dMsgRes'] || 'respuesta sin detalle'}`, 502);
  return { codigo: result['ns2:dCodRes'], mensaje: result['ns2:dMsgRes'] };
}

// Estado local según la "situación" que informa SISFE.
export function estadoLocal(situacion) {
  const value = Number(situacion);
  if (value === 2 || value === 3) return 'aprobado';
  if (value === 4) return 'rechazado';
  if (value === 99) return 'cancelado';
  if (value === 1) return 'enviado';
  return 'borrador';
}
