import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Ticket de comanda: contenido sin precios, insumos sumados por id, 58/80 mm, opción por PC y por defecto, y migración.
const schema = `test_comanda_ticket_${Date.now()}`;
const admin = new pg.Client(pool.options);
await admin.connect();
let server;

// Texto y tamaño de cada página de un PDF de pdfkit (fuentes estándar, contenido comprimido).
function leerPdf(buffer) {
  const raw = buffer.toString('latin1');
  const sizes = [...raw.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => ({ ancho: Number(m[1]), alto: Number(m[2]) }));
  const texts = [];
  for (const match of raw.matchAll(/(?<!end)stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content;
    try { content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1'); } catch { continue; }
    if (!content.includes('BT')) continue;
    texts.push([...content.matchAll(/\[([^\]]*)\] TJ/g)]
      .map(line => [...line[1].matchAll(/<([0-9a-f]+)>/gi)].map(hex => Buffer.from(hex[1], 'hex').toString('latin1')).join(''))
      .join(' ').replace(/\s+/g, ' '));
  }
  return { sizes, texts, text: texts.join('\n') };
}
const mm = value => value * 72 / 25.4;
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(await read('./schema.sql'));
    await setup.query(await read('./seed.sql'));
    await setup.query(await read('./migrations/20261121_impresora_config.sql')); // permiso de Configuración de impresora
    await setup.query('COMMIT');
  } finally { setup.release(); }

  // --- La migración deja las mismas columnas que schema.sql y se puede repetir
  const columns = async () => (await pool.query(`SELECT table_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema=$1 AND column_name='imprime_comanda' ORDER BY table_name`, [schema])).rows;
  const expected = await columns();
  assert.equal(expected.length, 2);
  await pool.query('ALTER TABLE impresora_config DROP COLUMN imprime_comanda; ALTER TABLE terminal DROP COLUMN imprime_comanda');
  const migration = await read('./migrations/20261124_comanda_ticket.sql');
  await pool.query(migration);
  await pool.query(migration);
  assert.deepEqual(await columns(), expected);

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const request = (path, { method = 'GET', role = 'admin', body } = {}) => fetch(base + path, { method, body: body && JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) } });
  const call = async (path, options = {}) => {
    const response = await request(path, options);
    const data = await response.json();
    assert.equal(response.status, options.status || 200, `${options.method || 'GET'} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const pdf = async (path, role = 'mozo') => {
    const response = await request(path, { role });
    assert.equal(response.status, 200, path);
    return leerPdf(Buffer.from(await response.arrayBuffer()));
  };

  // --- Productos e insumos de prueba
  const one = async (sql, values) => (await pool.query(sql, values)).rows[0].id;
  const categoria = await one("INSERT INTO categoria_menu(nombre) VALUES('HB-PRUEBA') RETURNING idcategoria_menu AS id");
  const grupo = await one("INSERT INTO grupo_menu(nombre) VALUES('Grupo comanda') RETURNING idgrupo_menu AS id");
  const unidadMedida = await one("INSERT INTO unidad_medida(codigo,nombre) VALUES('TST','Unidad de prueba') RETURNING idunidad_medida AS id");
  const producto = async (nombre, unidad, precio, cocina = true) => one(`INSERT INTO producto_menu(fk_idcategoria_menu,fk_idgrupo_menu,fk_idunidad_menu,nombre,precio_venta,es_cocina)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING idproducto_menu AS id`,
  [categoria, grupo, await one('INSERT INTO unidad_menu(nombre) VALUES($1) RETURNING idunidad_menu AS id', [unidad]), nombre, precio, cocina]);
  const doble = await producto('CLASICA', '(DOBLE)', 37777);
  const triple = await producto('BACON', '(TRIPLE)', 49999);
  const simple = await producto('SOLA', '(UNA)', 12345);
  const bebida = await producto('REFRESCO', '(500ML)', 8888, false);
  const insumo = nombre => one('INSERT INTO insumo(nombre,fk_idunidad_medida) VALUES($1,$2) RETURNING idinsumo AS id', [nombre, unidadMedida]);
  const carne = await insumo('CARNE 180gm');
  const otraCarne = await insumo('Carne 180gm'); // mismo nombre a la vista, otro id
  const salsa = await insumo('SALSA');
  const vaso = await insumo('VASO');
  for (const [product, supply, amount] of [[doble, carne, '2'], [triple, carne, '3'], [triple, otraCarne, '1'], [doble, salsa, '0.1'], [triple, salsa, '0.1'], [bebida, vaso, '1']]) {
    await pool.query('INSERT INTO producto_menu_insumo(fk_idproducto_menu,fk_idinsumo,cantidad) VALUES($1,$2,$3)', [product, supply, amount]);
  }
  const agregar = await one("INSERT INTO ingrediente(nombre,fk_idunidad_medida,precio_venta) VALUES('CATUPIRY TEST',$1,2345) RETURNING idingrediente AS id", [unidadMedida]);
  const quitar = await one("INSERT INTO ingrediente(nombre,fk_idunidad_medida) VALUES('CEBOLLA TEST',$1) RETURNING idingrediente AS id", [unidadMedida]);
  for (const ingredient of [agregar, quitar]) await pool.query('INSERT INTO producto_menu_ingrediente(fk_idproducto_menu,fk_idingrediente,cantidad) VALUES($1,$2,1)', [doble, ingredient]);

  const clientId = await one("SELECT idcliente AS id FROM cliente WHERE ruc='20123456789'");
  const clientName = (await pool.query('SELECT nombre_completo FROM cliente WHERE idcliente=$1', [clientId])).rows[0].nombre_completo;
  const mesa = (await pool.query('SELECT idmesa, numero FROM mesa ORDER BY idmesa LIMIT 1')).rows[0];
  const crear = async (detalles, extra = {}) => (await call('/api/pedidos', { method: 'POST',
    body: { clave: randomUUID(), tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, detalles, ...extra } })).pedido;
  const linea = (product, cantidad = 1, extra = {}) => ({ fk_idproducto_menu: product, cantidad, ...extra });
  let pedido = await crear([
    linea(doble, 2, { observaciones: 'bien cocida', precio_observacion: 1500,
      ingredientes: [{ idingrediente: agregar, tipo_modificacion: 'AGREGAR' }, { idingrediente: quitar, tipo_modificacion: 'QUITAR' }] }),
    linea(triple), linea(bebida, 4), linea(simple, 5)
  ], { tipo_entrega: 'COMER_ACA', fk_idmesa: mesa.idmesa });

  // La línea quitada no sale ni suma.
  const guardado = await call(`/api/pedidos/${pedido.idpedido}`);
  pedido = (await call(`/api/pedidos/${pedido.idpedido}`, { method: 'PUT', body: {
    clave: randomUUID(), version_web: guardado.version_web, tipo_entrega: 'COMER_ACA', fk_idmesa: mesa.idmesa, fk_idcliente: clientId, monto_descuento: 0,
    detalles: guardado.detalles.filter(d => d.fk_idproducto_menu !== simple).map(({ iddetalle_pedido, fk_idproducto_menu, cantidad }) => ({ iddetalle_pedido, fk_idproducto_menu, cantidad }))
  } })).pedido;

  // --- Contenido
  const path = `/api/pedidos/${pedido.idpedido}`;
  const comanda = await pdf(`${path}/comanda.pdf`);
  for (const expectedText of [`PEDIDO #${pedido.idpedido}`, 'Fecha:', `Cliente: ${clientName}`, 'Entrega: Comer acá', `Mesa: ${mesa.numero}`,
    '(2) HB-PRUEBA - CLASICA (DOBLE)', '(1) HB-PRUEBA - BACON (TRIPLE)', 'Con CATUPIRY TEST', 'Sin CEBOLLA TEST', 'Obs: bien cocida', 'INSUMOS',
    'CARNE 180gm 7 TST', 'Carne 180gm 1 TST', 'SALSA 0,3 TST']) assert.ok(comanda.text.includes(expectedText), `Falta "${expectedText}" en: ${comanda.text}`);
  assert.doesNotMatch(comanda.text, /Gs\.|TOTAL|c\/u|37\.777|49\.999|2\.345|1\.500|REFRESCO|VASO|SOLA|Teléfono|Dirección|COMPROBANTE|Gracias/i, 'Sin precios, totales, bebidas, líneas quitadas ni otros datos');
  assert.ok(comanda.text.indexOf('(1) HB-PRUEBA') < comanda.text.indexOf('INSUMOS'), 'Los insumos van al final');

  // --- Opción: arranca apagada; el ticket común nunca cambia
  const documentos = async (query = '', orderPath = path) => (await call(`${orderPath}/impresion${query}`, { role: 'mozo' })).documentos.map(d => d.nombre);
  const soloPedido = [`Pedido #${pedido.idpedido}`];
  const conComanda = [...soloPedido, `Comanda #${pedido.idpedido}`];
  assert.deepEqual(await documentos(), soloPedido);
  assert.equal((await pdf(`${path}/ticket.pdf?impresion=1`)).sizes.length, 1);

  const papel = { tamano_ticket: 80, saltos_final: 5 };
  await call('/api/impresora-config', { method: 'PUT', body: { ...papel, imprime_comanda: 'si' }, status: 400 });
  assert.equal((await call('/api/impresora-config', { method: 'PUT', body: { ...papel, imprime_comanda: true } })).imprime_comanda, true);
  assert.equal((await call('/api/impresora-config', { method: 'PUT', body: papel })).imprime_comanda, true, 'Si no viene, se conserva');
  assert.deepEqual(await documentos(), conComanda);
  assert.equal((await pdf(`${path}/ticket.pdf`)).sizes.length, 1, 'ticket.pdf sigue siendo una página');
  const juntos = await pdf(`${path}/ticket.pdf?impresion=1`);
  assert.equal(juntos.sizes.length, 2);
  assert.match(juntos.texts[0], /COMPROBANTE DE PEDIDO/);
  assert.match(juntos.texts[0], /TOTAL/);
  assert.equal(juntos.texts[1], comanda.text, 'La segunda página es la misma comanda');
  assert.deepEqual(juntos.sizes[1], comanda.sizes[0]);

  // --- Opción y papel por PC
  let pc = await call('/api/terminales/registrar', { method: 'POST', role: 'mozo', body: { equipo: 'CAJA-PRUEBA', impresoras: ['POS'], version: '1.0.0' } });
  assert.equal(pc.imprime_comanda, true, 'Una PC nueva toma el valor por defecto');
  const guardarPc = async (cambio, options = {}) => call(`/api/terminales/${pc.idterminal}`, { method: 'PUT', ...options,
    body: { nombre: 'Caja prueba', nombre_impresora: 'POS', activo: true, ...papel, ...cambio } });
  const q = `?terminal=${pc.idterminal}`;
  await guardarPc({ imprime_comanda: true }, { role: 'mozo', status: 403 });
  await guardarPc({ imprime_comanda: 1 }, { status: 400 });
  assert.equal((await guardarPc({ imprime_comanda: false })).imprime_comanda, false);
  assert.equal((await guardarPc({})).imprime_comanda, false, 'Si no viene, se conserva');
  assert.deepEqual(await documentos(q), soloPedido, 'La PC manda sobre el valor por defecto');
  assert.deepEqual(await documentos(), conComanda);
  pc = await call('/api/terminales/registrar', { method: 'POST', role: 'mozo', body: { equipo: 'CAJA-PRUEBA', impresoras: ['POS'] } });
  assert.equal(pc.imprime_comanda, false, 'Volver a registrar no pisa la opción de la PC');
  await guardarPc({ activo: false });
  assert.deepEqual(await documentos(q), conComanda, 'Una PC desactivada usa el valor por defecto');

  for (const tamano of [58, 80]) {
    await guardarPc({ tamano_ticket: tamano, imprime_comanda: true });
    const solo = await pdf(`${path}/comanda.pdf${q}`);
    const doble2 = await pdf(`${path}/ticket.pdf?impresion=1&terminal=${pc.idterminal}`);
    for (const size of [...solo.sizes, ...doble2.sizes]) assert.ok(Math.abs(size.ancho - mm(tamano === 80 ? 72 : 48)) < .1, `${tamano} mm: la página mide el ancho imprimible`);
    assert.ok(solo.text.includes('CARNE 180gm 7 TST'));
    const corto = await crear([linea(simple)]);
    const [size] = (await pdf(`/api/pedidos/${corto.idpedido}/comanda.pdf${q}`)).sizes;
    assert.ok(size.alto > size.ancho, 'Una comanda corta no queda apaisada');
    assert.doesNotMatch((await pdf(`/api/pedidos/${corto.idpedido}/comanda.pdf${q}`)).text, /INSUMOS|Mesa:/, 'Sin insumos no hay sección; sin mesa no hay mesa');
  }

  // --- Solo bebidas, anulado, largo y demasiado largo
  const bebidas = await crear([linea(bebida, 2)]);
  const bebidasPath = `/api/pedidos/${bebidas.idpedido}`;
  assert.deepEqual(await documentos('', bebidasPath), [`Pedido #${bebidas.idpedido}`]);
  await call(`${bebidasPath}/comanda.pdf`, { status: 409 });
  assert.equal((await pdf(`${bebidasPath}/ticket.pdf?impresion=1`)).sizes.length, 1);

  const anulado = await crear([linea(doble)]);
  const anuladoPath = `/api/pedidos/${anulado.idpedido}`;
  await call(`${anuladoPath}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Prueba', devoluciones: [] } });
  assert.deepEqual(await documentos('', anuladoPath), [`Pedido #${anulado.idpedido}`]);
  await call(`${anuladoPath}/comanda.pdf`, { status: 409 });

  const largo = await crear(Array.from({ length: 80 }, () => linea(triple)));
  const largoPdf = await pdf(`/api/pedidos/${largo.idpedido}/comanda.pdf`);
  assert.equal(largoPdf.sizes.length, 1, 'Una comanda larga sigue en una página');
  assert.ok(largoPdf.text.includes('CARNE 180gm 240 TST'));
  const enorme = await crear(Array.from({ length: 300 }, () => linea(doble, 1, { observaciones: 'x '.repeat(99).trim() })));
  const enormePath = `/api/pedidos/${enorme.idpedido}`;
  for (const url of [`${enormePath}/comanda.pdf`, `${enormePath}/ticket.pdf`, `${enormePath}/ticket.pdf?impresion=1`]) {
    const hojas = await pdf(url);
    assert.ok(hojas.sizes.length > 1, 'Más de 3 m sigue en otra hoja');
    assert.equal(hojas.texts.length, hojas.sizes.length, 'Sin hojas en blanco ni de más');
    for (const size of hojas.sizes) assert.ok(size.alto <= mm(3000) + 1, 'Ninguna hoja supera 3 m');
    assert.match(hojas.texts[1], /^ ?Continuación/);
    if (url.includes('comanda')) {
      assert.equal(hojas.text.split('(1) HB-PRUEBA - CLASICA (DOBLE)').length - 1, 300, 'No falta ningún renglón');
      assert.ok(hojas.text.includes('CARNE 180gm 600 TST'));
    } else {
      assert.equal(hojas.text.split('1 x Gs.').length - 1, 300, 'No falta ningún renglón');
      assert.match(hojas.text, /Gracias por su pedido/);
    }
  }

  // --- Permisos
  for (const suffix of ['comanda.pdf', 'impresion', 'ticket.pdf?impresion=1']) await call(`${path}/${suffix}`, { role: null, status: 401 });
  await call('/api/pedidos/999999999/comanda.pdf', { status: 404 });
  await pool.query(`UPDATE usuario_rol_item SET activo=false WHERE fk_idusuario_rol=(SELECT idusuario_rol FROM usuario_rol WHERE rol='mozo')
    AND fk_idusuario_rol_evento=(SELECT idusuario_rol_evento FROM usuario_rol_evento WHERE codigo_evento='FORM_PEDIDOS')`);
  for (const suffix of ['comanda.pdf', 'impresion']) await call(`${path}/${suffix}`, { role: 'mozo', status: 403 });

  console.log('PASS: ticket de comanda (contenido sin precios, insumos por id, 58/80 mm, opción por PC y por defecto, límites, permisos y migración).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.end();
}
