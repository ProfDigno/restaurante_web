import { Router } from 'express';
import { pool } from '../config/database.js';
import { fail, integer } from '../services/pedidos.js';
import { datosRestaurante, probarConexion } from '../services/sisfe.js';
import { normalizarRuc } from '../services/factura.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { if (['23514', '22001'].includes(error.code)) error.status = 400; next(error); }
};

// La API Key nunca sale del servidor: solo se informa si está configurada.
const publico = ({ sisfe_api_key, ...datos }) => ({ ...datos, sisfe_api_key_configurada: Boolean(sisfe_api_key) });
const text = (value, label, max, required = false) => {
  const s = String(value ?? '').trim();
  if (required && !s) fail(`${label} es obligatorio`);
  if (s.length > max) fail(`${label} admite hasta ${max} caracteres`);
  return s;
};

router.get('/', route(async () => publico(await datosRestaurante())));

router.put('/', route(async req => {
  const body = req.body || {};
  const ruc = text(body.ruc, 'El RUC', 30);
  const establecimiento = text(body.establecimiento, 'El establecimiento', 3, true);
  const punto = text(body.punto, 'El punto de expedición', 3, true);
  if (!/^\d{3}$/.test(establecimiento) || !/^\d{3}$/.test(punto)) fail('Establecimiento y punto deben tener 3 dígitos, por ejemplo 001');
  const numeroActual = integer(body.numero_actual, 'Último número emitido');
  const url = text(body.sisfe_url, 'La URL de SISFE', 250);
  if (url && !/^https?:\/\/[^\s/]+/i.test(url)) fail('La URL de SISFE debe empezar con http:// o https://');
  if (!['prueba', 'produccion'].includes(body.ambiente)) fail('Ambiente inválido');
  const usado = (await pool.query('SELECT COALESCE(max(numero),0) AS numero FROM factura WHERE establecimiento=$1 AND punto=$2', [establecimiento, punto])).rows[0].numero;
  if (numeroActual < Number(usado)) fail(`El último número emitido no puede ser menor que ${usado}, que ya existe para ${establecimiento}-${punto}`);
  const apiKey = String(body.sisfe_api_key || '').trim();
  await pool.query(`UPDATE datos_restaurante SET razon_social=$1,nombre_fantasia=$2,ruc=$3,timbrado=$4,direccion=$5,ciudad=$6,telefono=$7,email=$8,
      establecimiento=$9,punto=$10,numero_actual=$11,sisfe_url=$12,sisfe_tenant=$13,ambiente=$14,
      sisfe_api_key=CASE WHEN $15 = '' THEN sisfe_api_key ELSE $15 END,fecha_modificado=CURRENT_TIMESTAMP,modificado_por=$16
    WHERE iddatos_restaurante=1`,
  [text(body.razon_social, 'La razón social', 150), text(body.nombre_fantasia, 'El nombre de fantasía', 150), ruc ? normalizarRuc(ruc) : '',
    text(body.timbrado, 'El timbrado', 20), text(body.direccion, 'La dirección', 250), text(body.ciudad, 'La ciudad', 100),
    text(body.telefono, 'El teléfono', 40), text(body.email, 'El correo', 150), establecimiento, punto, numeroActual,
    url, text(body.sisfe_tenant, 'El tenant', 100), body.ambiente, apiKey, req.user.login]);
  return publico(await datosRestaurante());
}));

router.post('/probar-conexion', route(async () => probarConexion(await datosRestaurante())));

export default router;
