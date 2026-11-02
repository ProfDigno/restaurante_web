// Facturación electrónica contra un SISFE simulado, en un schema temporal; nunca toca public.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/config/database.js';
import pg from 'pg';

const schema = `test_facturas_${Date.now()}`;
assert.match(schema, /^test_facturas_[0-9]+$/);
const admin = new pg.Client(pool.options); await admin.connect();
let server; let fake; let checks = 0;
const ok = (value, label) => { assert.ok(value, label); console.log('OK', ++checks, label); };

// SISFE simulado: guarda lo recibido y permite forzar errores.
const lotes = new Map(); let seq = 76;
const sisfe = { requests: [], failNextCreate: false, rucs: { 4303489: ['ACTIVO', 'ACT', 'NOMBRE RAZON SOCIAL'] }, situacion: 0 };
const KEY = 'clave-de-prueba';
function fakeSisfe(req, res) {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    const url = new URL(req.url, 'http://x');
    sisfe.requests.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, body });
    const send = (status, data, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
    if (req.headers.authorization !== `Bearer api_key_${KEY}`) return send(403, { message: 'Token no válido' });
    const path = url.pathname.replace('/api/tenant-test', '');
    const document = (situacion, estado, loteId) => ({ cdc: String(loteId).padStart(44, '0'), respuesta_codigo: situacion === 2 ? '0260' : '', respuesta_mensaje: estado, situacion, estado, loteId, qr: 'https://ekuatia.set.gov.py/consultas/qr?x=1' });
    if (path === '/test') return send(200, { success: true, message: 'Conectado con SISFE', data: { conectado_sifen: true, ambiente: 'Pruebas' } });
    if (path.startsWith('/ruc/')) {
      const found = sisfe.rucs[path.slice(5)];
      return send(200, { success: true, data: { 'ns2:rResEnviConsRUC': found
        ? { 'ns2:dCodRes': '0502', 'ns2:dMsgRes': 'RUC encontrado', 'ns2:xContRUC': { 'ns2:dRUCCons': `${path.slice(5)}-6`, 'ns2:dRazCons': found[2], 'ns2:dCodEstCons': found[1], 'ns2:dDesEstCons': found[0], 'ns2:dRUCFactElec': 'N' } }
        : { 'ns2:dCodRes': '0500', 'ns2:dMsgRes': 'RUC no existe' } } });
    }
    if (path === '/lote/create') {
      if (sisfe.failNextCreate) { sisfe.failNextCreate = false; return send(200, { success: false, message: 'Error de validación simulado' }); }
      seq += 1;
      return send(200, { success: true, result: { loteId: seq, deList: [document(0, 'Borrador', seq)] } });
    }
    if (path.startsWith('/lote/draft-confirm/')) { const lote = Number(path.split('/').pop()); return send(200, { success: true, result: { loteId: lote, deList: [document(2, 'Aprobado', lote)] } }); }
    if (path === '/de/estado') { const lote = Number(body.cdcList[0].cdc); return send(200, { success: true, result: { deList: [document(sisfe.situacion, 'Estado', lote)] } }); }
    if (path === '/de/pdf') return send(200, '%PDF-1.4 simulado', 'application/pdf');
    if (path === '/evento/cancelacion') return send(200, { success: true, data: { 'ns2:rRetEnviEventoDe': { 'ns2:gResProcEVe': { 'ns2:gResProc': { 'ns2:dCodRes': '0600', 'ns2:dMsgRes': 'Evento registrado correctamente' } } } } });
    return send(404, { message: 'No encontrado' });
  });
}

try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    assert.equal((await setup.query('SELECT current_schema() AS s')).rows[0].s, schema);
    await setup.query('BEGIN');
    await setup.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
    await setup.query('COMMIT');
  } finally { setup.release(); }

  fake = http.createServer(fakeSisfe); await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
  const sisfeUrl = `http://127.0.0.1:${fake.address().port}`;

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const roleUsers = (await pool.query("SELECT u.idusuario,r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','encargado','mozo')")).rows;
  const cookies = Object.fromEntries(roleUsers.map(user => [user.rol, `restaurante_token=${signSession(user)}`]));
  async function call(path, { method = 'GET', body, role = 'admin', status = 200 } = {}) {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: cookies[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json(); assert.equal(r.status, status, `${method} ${path}: ${JSON.stringify(d)}`); return d;
  }
  const post = (path, body = {}, extra = {}) => call(path, { method: 'POST', body: { clave: randomUUID(), ...body }, ...extra });

  // Permisos
  await call('/api/facturas', { role: null, status: 401 });
  await call('/api/facturas', { role: 'mozo', status: 403 });
  await call('/api/datos-restaurante', { role: 'mozo', status: 403 });
  ok(true, 'Facturas y Datos de restaurante exigen sesión y permiso');

  // Datos de restaurante
  const inicial = await call('/api/datos-restaurante');
  ok(inicial.sisfe_api_key_configurada === false && !('sisfe_api_key' in inicial), 'La API Key no se devuelve al navegador');
  await call('/api/datos-restaurante/probar-conexion', { method: 'POST', status: 409 });
  ok(true, 'Probar la conexión sin configurar pide configurar SISFE');
  const config = { razon_social: 'RESTAURANTE SA', nombre_fantasia: 'Resto', ruc: '80012345', timbrado: '12345678', direccion: 'Calle 1', ciudad: 'Asunción', telefono: '021', email: 'a@b.py',
    establecimiento: '001', punto: '001', numero_actual: 0, sisfe_url: sisfeUrl, sisfe_tenant: 'tenant-test', sisfe_api_key: KEY, ambiente: 'prueba' };
  const guardado = await call('/api/datos-restaurante', { method: 'PUT', body: config });
  ok(guardado.sisfe_api_key_configurada && !('sisfe_api_key' in guardado) && /^80012345-\d$/.test(guardado.ruc), 'Guarda la configuración, completa el dígito del RUC y oculta la API Key');
  await call('/api/datos-restaurante', { method: 'PUT', body: { ...config, sisfe_api_key: '', ruc: '80012345-0', establecimiento: '1' }, status: 400 });
  await call('/api/datos-restaurante', { method: 'PUT', body: { ...config, sisfe_api_key: '' } });
  ok((await pool.query('SELECT sisfe_api_key FROM datos_restaurante')).rows[0].sisfe_api_key === KEY, 'Una API Key vacía conserva la guardada');
  const conexion = await call('/api/datos-restaurante/probar-conexion', { method: 'POST' });
  ok(conexion.conectado_sifen === true && sisfe.requests.at(-1).auth === `Bearer api_key_${KEY}`, 'Prueba de conexión con Authorization: Bearer api_key_<clave>');

  // Verificación de RUC
  const dv4303489 = (await call('/api/facturas/ruc/4303489-6')).dv_correcto;
  ok(dv4303489 === true, 'Dígito verificador de un RUC real');
  const rucOk = await call('/api/facturas/ruc/4303489');
  ok(rucOk.encontrado && rucOk.razon_social === 'NOMBRE RAZON SOCIAL' && rucOk.activo, 'Verifica el RUC en SISFE y devuelve la razón social');
  const rucMalDv = await call('/api/facturas/ruc/4303489-1');
  ok(rucMalDv.dv_correcto === false && rucMalDv.encontrado === false, 'Rechaza un dígito verificador incorrecto sin consultar a SISFE');
  const rucNo = await call('/api/facturas/ruc/1234567');
  ok(rucNo.encontrado === false, 'RUC inexistente');
  await call('/api/facturas/ruc/abc', { status: 400 });

  // Pedido de prueba
  const catalog = await call('/api/pedidos/catalogo', { role: 'mozo' });
  const drink = catalog.items.find(x => x.nombre === 'Gaseosa');
  const zone = (await pool.query('SELECT idzona_cliente FROM zona_cliente ORDER BY idzona_cliente LIMIT 1')).rows[0].idzona_cliente;
  const cliente = (await call('/api/clientes', { method: 'POST', body: { clave: randomUUID(), nombre_completo: 'Cliente Factura', razon_social: 'CLIENTE FACTURA SA', ruc: '4303489-6', telefono: '0981000000', direccion: 'Dirección', fk_idzona_cliente: zone }, status: 201 })).item;
  const sinRuc = (await post('/api/pedidos/clientes/rapido', { nombre: 'Sin documento', tipo_entrega: 'BUSCAR' }, { role: 'mozo' })).item;
  const crearPedido = async (clienteId, cantidad = 2, extra = {}) => (await post('/api/pedidos', { tipo_entrega: 'BUSCAR', fk_idcliente: clienteId, monto_descuento: 0, detalles: [{ fk_idproducto_menu: drink.idproducto_menu, cantidad, precio_venta: 1 }], ...extra }, { role: 'mozo' })).pedido;
  const pedido = await crearPedido(cliente.idcliente);
  ok(Number(pedido.monto_total) === 3000, 'Pedido de prueba con total 3.000');

  // Precarga
  const pre = await call(`/api/facturas/desde-pedido/${pedido.idpedido}`);
  ok(pre.existente === false && pre.borrador.cuadra && pre.borrador.total === 3000 && pre.borrador.detalles.length === 1, 'Precarga detalles del pedido y los totales cuadran');
  ok(pre.borrador.detalles[0].iva === 10 && pre.borrador.total_iva10 === 273 && pre.borrador.base_gravada10 === 2727, 'Todos los productos al 10%: IVA = total / 11');
  ok(pre.borrador.cliente.ruc === '4303489-6' && pre.borrador.cliente.razon_social === 'CLIENTE FACTURA SA', 'Precarga el cliente del pedido con su RUC y razón social');

  // Creación: borrador en SISFE
  const creada = await post('/api/facturas', { fk_idpedido: pedido.idpedido, cliente: pre.borrador.cliente });
  ok(creada.estado === 'borrador' && creada.numero_completo === '001-001-0000001' && creada.cdc?.length === 44 && creada.lote_id === 77, 'Crea la factura en borrador con número, CDC y lote');
  const envio = sisfe.requests.find(r => r.path.endsWith('/lote/create'));
  const doc = envio.body[0];
  ok(envio.query === '?draft=t' && envio.body.length === 1, 'Envía el lote como borrador (?draft=t)');
  ok(doc.tipoDocumento === 1 && doc.numero === '0000001' && doc.tipoImpuesto === 1 && doc.moneda === 'PYG', 'Documento: factura, número de 7 dígitos, IVA, PYG');
  ok(doc.condicion.tipo === 1 && doc.condicion.entregas.length === 1 && doc.condicion.entregas[0].tipo === 1 && doc.condicion.entregas[0].monto === 3000, 'Siempre contado y pago en efectivo por el total');
  ok(doc.items.every(i => i.ivaTipo === 1 && i.ivaBase === 100 && i.iva === 10 && i.unidadMedida === 77), 'Ítems gravados al 10%');
  ok(doc.cliente.contribuyente === true && doc.cliente.ruc === '4303489-6' && doc.cliente.tipoContribuyente === 1 && doc.cliente.tipoOperacion === 2 && doc.cliente.pais === 'PRY', 'Cliente con RUC: contribuyente persona física (B2C)');
  ok(creada.detalles.length === 1 && creada.total === '3000', 'Guarda el detalle de la factura en su propia tabla');
  const repetida = await call('/api/facturas', { method: 'POST', body: { clave: randomUUID(), fk_idpedido: pedido.idpedido, cliente: pre.borrador.cliente }, status: 409 });
  ok(/ya tiene una factura/.test(repetida.error), 'No se factura dos veces el mismo pedido');
  const existente = await call(`/api/facturas/desde-pedido/${pedido.idpedido}`);
  ok(existente.existente && existente.factura.idfactura === creada.idfactura, 'El botón del pedido abre la factura existente');

  // Pedido facturado bloqueado
  await post(`/api/pedidos/${pedido.idpedido}/anular`, { motivo: 'prueba', devoluciones: [] }, { status: 409, role: 'admin' });
  ok(true, 'Un pedido facturado no puede anularse');

  // Confirmación
  const aprobada = await call(`/api/facturas/${creada.idfactura}/confirmar`, { method: 'POST' });
  ok(aprobada.estado === 'aprobado' && sisfe.requests.at(-1).path.endsWith('/lote/draft-confirm/77'), 'Confirma el borrador y queda aprobada');
  await call(`/api/facturas/${creada.idfactura}/confirmar`, { method: 'POST', status: 409 });
  const kude = await fetch(`${base}/api/facturas/${creada.idfactura}/kude.pdf`, { headers: { Cookie: cookies.admin } });
  ok(kude.status === 200 && kude.headers.get('content-type') === 'application/pdf' && (await kude.text()).startsWith('%PDF'), 'Descarga el KUDE (PDF) a través del servidor');
  const lista = await call('/api/facturas?search=0000001&estado=aprobado');
  ok(lista.total === 1 && lista.items[0].numero_completo === '001-001-0000001', 'Listado con búsqueda por número y filtro de estado');
  const rango = await call(`/api/facturas?inicio=2000-01-01&fin=2000-01-02`);
  ok(rango.total === 0, 'Filtro por rango de fechas');
  await call('/api/facturas?inicio=2026-02-01&fin=2026-01-01', { status: 400 });

  // Cancelación
  await call(`/api/facturas/${creada.idfactura}/cancelar`, { method: 'POST', body: { motivo: 'no' }, status: 400 });
  const cancelada = await call(`/api/facturas/${creada.idfactura}/cancelar`, { method: 'POST', body: { motivo: 'Pago no recibido' } });
  ok(cancelada.estado === 'cancelado' && cancelada.motivo_cancelado === 'Pago no recibido', 'Cancela una factura aprobada con motivo');
  const nuevaDelMismo = await call(`/api/facturas/desde-pedido/${pedido.idpedido}`);
  ok(nuevaDelMismo.existente === false, 'Tras cancelar, el pedido puede volver a facturarse');

  // Cliente sin RUC: innominado
  const pedido2 = await crearPedido(sinRuc.idcliente, 1);
  const pre2 = await call(`/api/facturas/desde-pedido/${pedido2.idpedido}`);
  ok(pre2.borrador.cliente.ruc === '', 'Cliente sin RUC llega sin RUC');
  const factura2 = await post('/api/facturas', { fk_idpedido: pedido2.idpedido, cliente: pre2.borrador.cliente });
  const doc2 = sisfe.requests.filter(r => r.path.endsWith('/lote/create')).at(-1).body[0];
  ok(factura2.numero_completo === '001-001-0000002' && doc2.cliente.contribuyente === false && doc2.cliente.razonSocial === 'Sin Nombre' && doc2.cliente.documentoTipo === 5 && doc2.cliente.documentoNumero === '0', 'Sin RUC se emite como innominado y la numeración continúa');

  // Cambiar de cliente / editar el cliente antes de facturar
  const pedido3 = await crearPedido(sinRuc.idcliente, 1);
  const f3 = await post('/api/facturas', { fk_idpedido: pedido3.idpedido, cliente: { fk_idcliente: cliente.idcliente, ruc: '80012345', razon_social: 'OTRA EMPRESA SA', email: 'x@y.py' } });
  const doc3 = sisfe.requests.filter(r => r.path.endsWith('/lote/create')).at(-1).body[0];
  ok(doc3.cliente.ruc === '80012345-' + f3.cliente_ruc.split('-')[1] && doc3.cliente.tipoContribuyente === 2 && doc3.cliente.tipoOperacion === 1 && doc3.cliente.razonSocial === 'OTRA EMPRESA SA' && doc3.cliente.email === 'x@y.py', 'Permite cambiar y editar el cliente; RUC de empresa va como persona jurídica (B2B) con dígito completado');
  const pedido4 = await crearPedido(cliente.idcliente, 1);
  await call('/api/facturas', { method: 'POST', body: { clave: randomUUID(), fk_idpedido: pedido4.idpedido, cliente: { ruc: '4303489-1', razon_social: 'X' } }, status: 400 });
  ok(true, 'Rechaza un RUC con dígito verificador incorrecto al facturar');

  // Error de SISFE: conserva número y se reintenta
  sisfe.failNextCreate = true;
  const clave = randomUUID();
  const fallo = await call('/api/facturas', { method: 'POST', body: { clave, fk_idpedido: pedido4.idpedido, cliente: { fk_idcliente: cliente.idcliente, ruc: '4303489-6', razon_social: 'CLIENTE FACTURA SA' } }, status: 502 });
  ok(/validación simulado/.test(fallo.error), 'Un error de SISFE se informa con su mensaje');
  const conError = (await pool.query('SELECT idfactura,estado,numero FROM factura WHERE fk_idpedido=$1', [pedido4.idpedido])).rows[0];
  ok(conError.estado === 'error' && conError.numero === 4, 'La factura queda en error conservando su número');
  const reintentada = await call(`/api/facturas/${conError.idfactura}/reintentar`, { method: 'POST' });
  ok(reintentada.estado === 'borrador' && reintentada.numero === 4, 'Reintentar emite con el mismo número');
  const mismaClave = await call('/api/facturas', { method: 'POST', body: { clave, fk_idpedido: pedido4.idpedido, cliente: { fk_idcliente: cliente.idcliente, ruc: '4303489-6', razon_social: 'CLIENTE FACTURA SA' } } });
  ok(mismaClave.idfactura === conError.idfactura, 'Repetir la misma operación no duplica la factura');

  // Estado y descuento
  sisfe.situacion = 2;
  const refrescada = await call(`/api/facturas/${conError.idfactura}/estado`, { method: 'POST' });
  ok(refrescada.estado === 'aprobado', 'Consulta el estado en SISFE y lo actualiza');
  const pedido5 = await crearPedido(cliente.idcliente, 3, { monto_descuento: 1000, motivo_descuento: 'promo' });
  const pre5 = await call(`/api/facturas/desde-pedido/${pedido5.idpedido}`);
  ok(pre5.borrador.cuadra && pre5.borrador.total === Number(pedido5.monto_total) && pre5.borrador.detalles.reduce((s, l) => s + l.cantidad, 0) === 3 && pre5.borrador.detalles.length === 2, 'El descuento se reparte por unidad: una línea se divide y el total cuadra al guaraní');
  const f5 = await post('/api/facturas', { fk_idpedido: pedido5.idpedido, cliente: pre5.borrador.cliente });
  ok(Number(f5.total) === Number(pedido5.monto_total), 'Factura con descuento por el mismo total del pedido');

  // Config: numeración no retrocede
  const bajar = await call('/api/datos-restaurante', { method: 'PUT', body: { ...config, sisfe_api_key: '', numero_actual: 1 }, status: 400 });
  ok(/no puede ser menor/.test(bajar.error), 'No permite bajar el último número por debajo de los emitidos');

  console.log(`PASS: ${checks} escenarios de factura electrónica con SISFE simulado.`);
} catch (e) { console.error(e); process.exitCode = 1; } finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (fake) await new Promise(resolve => fake.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end(); console.log('Esquema temporal de pruebas eliminado; datos de trabajo intactos.');
}
