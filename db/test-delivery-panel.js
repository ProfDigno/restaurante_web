import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { pool } from '../src/config/database.js';

// Panel del entregador (/delivery): login con usuario y PIN, pedidos de la caja abierta (propios y sin asignar),
// auto-asignación y forma de pago indicada. Se prueba en un esquema temporal que se borra al final.
const schema = `test_delivery_panel_${Date.now()}`;
const admin = new pg.Client(pool.options);
await admin.connect();
let server; let checks = 0;
const ok = (value, label) => { assert.ok(value, label); console.log('OK', ++checks, label); };
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
    // Las migraciones se pueden correr sobre una base que ya las tiene.
    await setup.query(await readFile(new URL('./migrations/20261129_entregador_acceso.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./migrations/20261130_delivery_panel.sql', import.meta.url), 'utf8'));
    await setup.query('COMMIT');
  } finally { setup.release(); }

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const adminUser = (await pool.query("SELECT u.idusuario FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol='admin' LIMIT 1")).rows[0];
  const adminCookie = `restaurante_token=${signSession(adminUser)}`;
  const request = async (path, { method = 'GET', cookie = adminCookie, body } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { status: response.status, data, cookie: response.headers.get('set-cookie') };
  };
  const post = (path, body) => request(path, { method: 'POST', body: { clave: randomUUID(), ...body } });
  const login = (usuario, pin) => request('/api/delivery-app/login', { method: 'POST', cookie: null, body: { login: usuario, pin } });

  // --- Datos
  const pinHash = await bcrypt.hash('1234', 4);
  const ana = (await pool.query("INSERT INTO entregador_delivery(nombre_completo,usuario,password_hash) VALUES('Ana Moto','ana',$1) RETURNING identregador_delivery AS id", [pinHash])).rows[0].id;
  const beto = (await pool.query("INSERT INTO entregador_delivery(nombre_completo,usuario,password_hash) VALUES('Beto Bici','beto',$1) RETURNING identregador_delivery AS id", [pinHash])).rows[0].id;
  await pool.query("INSERT INTO entregador_delivery(nombre_completo,usuario,password_hash) VALUES('Ceci Bloqueo','ceci',$1)", [pinHash]);
  const client = (await pool.query("SELECT idcliente, fk_idzona_cliente FROM cliente WHERE ruc='20123456789'")).rows[0];
  await pool.query('UPDATE zona_cliente SET precio_delivery=15000 WHERE idzona_cliente=$1', [client.fk_idzona_cliente]);
  const plato = (await pool.query("SELECT idproducto_menu AS id FROM producto_menu WHERE nombre='Plato de la casa'")).rows[0].id;
  await pool.query('UPDATE producto_menu SET stock_actual=100, precio_venta=30000 WHERE idproducto_menu=$1', [plato]);
  const forma = async name => (await pool.query('SELECT idforma_pago FROM forma_pago WHERE nombre=$1', [name])).rows[0].idforma_pago;
  const cash = await forma('Efectivo'), card = await forma('Débito');
  const order = async () => {
    const r = await post('/api/pedidos', { tipo_entrega: 'DELIVERY', fk_idcliente: client.idcliente, monto_descuento: 0, detalles: [{ fk_idproducto_menu: plato, cantidad: 2 }] });
    assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data.pedido;
  };

  // --- Login
  ok((await login('ana', '9999')).status === 401, 'PIN incorrecto rechazado');
  ok((await login('ana', '12a4')).status === 400, 'PIN con letras rechazado');
  const anaLogin = await login('ANA', '1234');
  ok(anaLogin.status === 200 && anaLogin.data.entregador.nombre === 'Ana Moto' && /delivery_token=/.test(anaLogin.cookie), 'Login sin distinguir mayúsculas y cookie propia');
  const anaCookie = anaLogin.cookie.split(';')[0];
  const betoCookie = (await login('beto', '1234')).cookie.split(';')[0];
  for (let i = 0; i < 5; i += 1) await login('ceci', '0000');
  ok((await login('ceci', '1234')).status === 429, 'Bloqueo después de 5 intentos fallidos');
  ok((await request('/api/delivery-app/me', { cookie: anaCookie })).data.entregador.id === ana, 'Sesión del entregador (/me)');
  ok((await request('/api/pedidos', { cookie: anaCookie })).status === 401, 'La sesión del entregador no entra al sistema');
  ok((await request('/api/delivery-app/pedidos')).status === 401, 'La sesión del sistema no entra al panel delivery');

  // --- Pedidos de la caja abierta
  const antes = await order();
  ok((await request('/api/delivery-app/pedidos', { cookie: anaCookie })).data.caja_abierta === false, 'Sin caja abierta no hay pedidos');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal((await post('/api/cajas/abrir', { monto_inicial: 100000 })).status, 200);
  const libre = await order();
  const deBeto = await order();
  assert.equal((await post(`/api/pagos-delivery/pedidos/${deBeto.idpedido}/entregador`, { fk_identregador_delivery: beto })).status, 200);
  let lista = (await request('/api/delivery-app/pedidos', { cookie: anaCookie })).data;
  const ids = lista.pedidos.map(p => p.idpedido);
  ok(ids.includes(libre.idpedido) && !ids.includes(deBeto.idpedido) && !ids.includes(antes.idpedido), 'Ve los sin asignar de la caja abierta, no los de otro ni los anteriores');
  const p = lista.pedidos.find(x => x.idpedido === libre.idpedido);
  ok(!p.mio && p.productos.length === 1 && p.productos[0].cantidad === 2 && p.productos[0].subtotal === 60000 && p.delivery === 15000 && p.total === 75000 && p.saldo === 75000,
    'Datos del pedido: productos, subtotal, delivery y total');
  ok(p.cliente && p.direccion && p.telefono && p.fecha && p.hora, 'Datos del cliente, fecha y hora');
  ok(/^.+ - Plato de la casa - .+$/.test(p.productos[0].nombre), 'Producto como Categoría - Nombre - Unidad: ' + p.productos[0].nombre);
  ok(!('ingredientes' in p.productos[0]) && lista.formas.some(f => f.idforma_pago === cash), 'Sin ingredientes y con formas de pago');

  // --- Auto-asignación
  ok((await request(`/api/delivery-app/pedidos/${libre.idpedido}/asignarme`, { method: 'POST', cookie: anaCookie, body: {} })).status === 200, 'Se asigna el pedido');
  ok((await request(`/api/delivery-app/pedidos/${libre.idpedido}/asignarme`, { method: 'POST', cookie: betoCookie, body: {} })).status === 409, 'Otro entregador ya no puede tomarlo');
  ok(!(await request('/api/delivery-app/pedidos', { cookie: betoCookie })).data.pedidos.some(x => x.idpedido === libre.idpedido), 'Desaparece para el otro entregador');
  lista = (await request('/api/delivery-app/pedidos', { cookie: anaCookie })).data;
  ok(lista.pedidos.find(x => x.idpedido === libre.idpedido).mio, 'Queda como propio');
  ok((await pool.query("SELECT 1 FROM auditoria WHERE accion='ENTREGADOR_ASIGNADO' AND id_entidad=$1 AND usuario_login='delivery:ana'", [libre.idpedido])).rowCount === 1, 'Asignación auditada');

  // --- Forma de pago indicada
  ok((await request(`/api/delivery-app/pedidos/${libre.idpedido}/forma-pago`, { method: 'PUT', cookie: betoCookie, body: { fk_idforma_pago: card } })).status === 404, 'No puede indicar forma en un pedido ajeno');
  const indicada = await request(`/api/delivery-app/pedidos/${libre.idpedido}/forma-pago`, { method: 'PUT', cookie: anaCookie, body: { fk_idforma_pago: card } });
  ok(indicada.status === 200 && indicada.data.forma_pago_entrega === 'Débito', 'Indica la forma de pago');
  const caja = (await request('/api/cajas')).data.abierta;
  const movimientos = (await pool.query('SELECT count(*)::int AS n FROM pago WHERE fk_idpedido=$1 OR fk_idcuenta=$2', [libre.idpedido, libre.fk_idcuenta])).rows[0].n;
  ok(caja && movimientos === 0, 'Indicar la forma no registra cobro');
  const rendicion = (await request(`/api/pagos-delivery/rendicion/${ana}`)).data;
  ok(rendicion.pedidos.find(x => x.idpedido === libre.idpedido)?.fk_idforma_pago_entrega === card, 'La rendición recibe la forma indicada');
  // Con un cobro registrado ya no se puede indicar.
  assert.equal((await post(`/api/pedidos/${deBeto.idpedido}/pago-anticipado`, { fk_idforma_pago: cash, importe: 1000 })).status, 200);
  ok((await request(`/api/delivery-app/pedidos/${deBeto.idpedido}/forma-pago`, { method: 'PUT', cookie: betoCookie, body: { fk_idforma_pago: card } })).status === 409, 'Con cobro registrado no se indica forma');

  // --- Totales del turno: neto = efectivo − delivery; POS aparte (debe coincidir con el reporte de la máquina).
  await pool.query("UPDATE forma_pago SET usa_pos=true WHERE idforma_pago=$1", [card]);
  const hash2 = await bcrypt.hash('5555', 4);
  const dani = (await pool.query("INSERT INTO entregador_delivery(nombre_completo,usuario,password_hash) VALUES('Dani Turno','dani',$1) RETURNING identregador_delivery AS id", [hash2])).rows[0].id;
  await pool.query("INSERT INTO entregador_delivery(nombre_completo,usuario,password_hash) VALUES('Eli Pos','eli',$1)", [hash2]);
  const daniCookie = (await login('dani', '5555')).cookie.split(';')[0];
  const eliCookie = (await login('eli', '5555')).cookie.split(';')[0];
  const tomar = async (cookie, forma) => {
    const o = await order();
    assert.equal((await request(`/api/delivery-app/pedidos/${o.idpedido}/asignarme`, { method: 'POST', cookie, body: {} })).status, 200);
    if (forma) assert.equal((await request(`/api/delivery-app/pedidos/${o.idpedido}/forma-pago`, { method: 'PUT', cookie, body: { fk_idforma_pago: forma } })).status, 200);
    return o;
  };
  const enEfectivo = await tomar(daniCookie, cash), sinForma = await tomar(daniCookie, null), conPos = await tomar(daniCookie, card);
  const totales = async cookie => (await request('/api/delivery-app/pedidos', { cookie })).data.totales;
  let t = await totales(daniCookie);
  ok(t.pedidos === 3 && t.efectivo === 150000 && t.pos_total === 75000 && t.pos[0]?.nombre === 'Débito' && t.delivery === 45000 && t.neto === 105000,
    'Totales: efectivo 150.000, POS 75.000, delivery 45.000, entrega 105.000');
  ok(t.sin_forma === 1 && t.pendiente.pedidos === 3 && t.rendido.pedidos === 0, 'Pedido sin forma se cuenta como efectivo y se avisa');
  const eliPos = await tomar(eliCookie, card);
  t = await totales(eliCookie);
  ok(t.efectivo === 0 && t.pos_total === 75000 && t.neto === -15000, 'Todo por POS: neto negativo (la caja le paga el delivery)');
  // Rendir dos pedidos: el turno sigue igual, pasan de "falta rendir" a "ya rendido" con los cobros reales.
  const pedidosRendir = [
    { idpedido: enEfectivo.idpedido, pagos: [{ fk_idforma_pago: cash, importe: 75000 }] },
    { idpedido: conPos.idpedido, pagos: [{ fk_idforma_pago: card, importe: 75000 }] }];
  // Con cobros por POS es obligatorio indicar la máquina y el monto de su resumen; la diferencia se guarda.
  const sinMaquina = await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: dani, pedidos: pedidosRendir });
  ok(sinMaquina.status === 400 && /máquina POS/.test(sinMaquina.data.error), 'Sin máquina POS no se puede rendir un cobro con POS');
  const maquina = (await pool.query("INSERT INTO maquina_pos(nombre,numero) VALUES('POS Prueba','P-1') RETURNING idmaquina_pos AS id")).rows[0].id;
  const rendir = await post('/api/pagos-delivery/rendir', { fk_identregador_delivery: dani, fk_idmaquina_pos: maquina, pos_informado: 70000, pedidos: pedidosRendir });
  assert.equal(rendir.status, 200, JSON.stringify(rendir.data));
  ok(rendir.data.rendicion.pos_sistema === 75000 && rendir.data.rendicion.pos_informado === 70000 && rendir.data.rendicion.maquina_pos === 'POS Prueba',
    'La rendición guarda la máquina, lo del sistema y lo del resumen (con diferencia)');
  t = await totales(daniCookie);
  ok(t.efectivo === 150000 && t.pos_total === 75000 && t.delivery === 45000 && t.neto === 105000, 'Después de rendir, el turno mantiene sus totales');
  ok(t.rendido.pedidos === 2 && t.rendido.neto === 45000 && t.pendiente.pedidos === 1 && t.pendiente.neto === 60000, 'Separa lo ya rendido de lo que falta rendir');
  ok(rendir.data.rendicion.neto === t.rendido.neto, 'El neto rendido coincide con la Rendición');
  assert.ok(sinForma && eliPos);

  // --- Cambiar el PIN cierra la sesión
  assert.equal((await request(`/api/entregadores-delivery/${ana}`, { method: 'PUT', body: { nombre_completo: 'Ana Moto', usuario: 'ana', password: '4321' } })).status, 200);
  ok((await request('/api/delivery-app/pedidos', { cookie: anaCookie })).status === 401, 'Con PIN nuevo la sesión anterior deja de valer');
  ok((await login('ana', '4321')).status === 200, 'Ingresa con el PIN nuevo');
  await pool.query('UPDATE entregador_delivery SET activo=false WHERE identregador_delivery=$1', [beto]);
  ok((await request('/api/delivery-app/pedidos', { cookie: betoCookie })).status === 401, 'Entregador inactivo pierde la sesión');
  console.log(`\n${checks} comprobaciones del panel delivery OK`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
