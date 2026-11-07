import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Auditoría de acciones sensibles: qué se registra, qué no, permisos, filtros, Excel e inmutabilidad.
const schema = `test_auditoria_${Date.now()}`;
const admin = new pg.Client(pool.options);
await admin.connect();
let server;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool.options.options = `-c search_path=${schema}`;
  const setup = await pool.connect();
  try {
    await setup.query('BEGIN');
    await setup.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await setup.query(await readFile(new URL('./seed.sql', import.meta.url), 'utf8'));
    await setup.query('COMMIT');
  } finally { setup.release(); }

  const { default: app } = await import('../src/app.js');
  const { signSession } = await import('../src/middleware/auth.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, raw = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw) { assert.equal(response.status, status); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const rows = async (accion, id = null) => (await pool.query(
    `SELECT * FROM auditoria WHERE accion=$1 AND ($2::int IS NULL OR id_entidad=$2) ORDER BY idauditoria`, [accion, id])).rows;
  const count = async () => (await pool.query('SELECT count(*)::int AS n FROM auditoria')).rows[0].n;

  // --- Permisos del formulario
  await call('/api/auditoria', { role: null, status: 401 });
  await call('/api/auditoria', { role: 'mozo', status: 403 });
  assert.equal((await call('/api/auditoria')).total, 0);
  assert.ok((await call('/api/auth/me')).user.permisos.includes('FORM_AUDITORIA'));

  // --- Pedidos: descuento, precio manual, reducir y quitar líneas, anular
  const clientId = (await pool.query("SELECT idcliente FROM cliente WHERE ruc='20123456789'")).rows[0].idcliente;
  const plato = (await pool.query("SELECT idproducto_menu, precio_venta FROM producto_menu WHERE nombre='Plato de la casa'")).rows[0];
  const gaseosa = (await pool.query("SELECT idproducto_menu, precio_venta FROM producto_menu WHERE nombre='Gaseosa'")).rows[0];
  await pool.query('UPDATE producto_menu SET stock_actual=100 WHERE idproducto_menu=ANY($1::int[])', [[plato.idproducto_menu, gaseosa.idproducto_menu]]);
  const orderBody = (detalles, extra = {}) => ({ clave: randomUUID(), tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, detalles, ...extra });

  const plain = (await call('/api/pedidos', { method: 'POST', body: orderBody([{ fk_idproducto_menu: gaseosa.idproducto_menu, cantidad: 1 }]) })).pedido;
  assert.equal(await count(), 0, 'Un pedido normal no genera auditoría');

  const manualPrice = Number(gaseosa.precio_venta) + 500;
  const created = (await call('/api/pedidos', { method: 'POST', body: orderBody([
    { fk_idproducto_menu: plato.idproducto_menu, cantidad: 3 },
    { fk_idproducto_menu: gaseosa.idproducto_menu, cantidad: 1, precio_fijado: true, precio_venta: manualPrice }
  ], { monto_descuento: 1000, motivo_descuento: 'Cliente frecuente' }) })).pedido;
  const [descuento] = await rows('PEDIDO_DESCUENTO', created.idpedido);
  assert.deepEqual([descuento.antes, descuento.despues, descuento.motivo], [{ monto_descuento: 0, motivo_descuento: null }, { monto_descuento: 1000, motivo_descuento: 'Cliente frecuente' }, 'Cliente frecuente']);
  assert.equal(descuento.usuario_login, 'admin');
  assert.match(descuento.ip, /127\.0\.0\.1/);
  const [precio] = await rows('PEDIDO_PRECIO_MANUAL', created.idpedido);
  assert.equal(precio.antes.precio_lista, Number(gaseosa.precio_venta));
  assert.equal(precio.despues.precio_venta, manualPrice);

  const full = await call(`/api/pedidos/${created.idpedido}`);
  const platoLine = full.detalles.find(line => line.fk_idproducto_menu === plato.idproducto_menu);
  await call(`/api/pedidos/${created.idpedido}`, { method: 'PUT', body: { ...orderBody([{ iddetalle_pedido: platoLine.iddetalle_pedido, fk_idproducto_menu: plato.idproducto_menu, cantidad: 1 }]), version_web: full.version_web, monto_descuento: 1000, motivo_descuento: 'Cliente frecuente' } });
  const [reducida] = await rows('PEDIDO_LINEA_REDUCIDA', created.idpedido);
  assert.equal(reducida.antes.cantidad, 3); assert.equal(reducida.despues.cantidad, 1);
  const [quitada] = await rows('PEDIDO_LINEA_ANULADA', created.idpedido);
  assert.match(quitada.antes.producto, /Gaseosa/); assert.equal(quitada.antes.precio_venta, manualPrice);
  assert.equal((await rows('PEDIDO_DESCUENTO', created.idpedido)).length, 1, 'Guardar con el mismo descuento no repite el registro');

  const before = await count();
  await call(`/api/pedidos/${plain.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: '', devoluciones: [] }, status: 400 });
  assert.equal(await count(), before, 'Una anulación rechazada no deja auditoría');
  await call(`/api/pedidos/${plain.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Cliente se fue', devoluciones: [] } });
  const [anulado] = await rows('PEDIDO_ANULADO', plain.idpedido);
  assert.equal(anulado.motivo, 'Cliente se fue');
  assert.equal(anulado.antes.estado, 'en_preparacion');
  assert.deepEqual(anulado.antes.productos.length, 1);
  assert.equal(anulado.despues.devuelto, 0);

  // --- Productos e ingredientes: solo precio y stock
  const product = (await call('/api/productos-menu?pageSize=100')).items.find(item => item.idproducto_menu === gaseosa.idproducto_menu);
  await call(`/api/productos-menu/${product.idproducto_menu}`, { method: 'PUT', body: { ...product, descripcion: 'Solo cambia el texto' } });
  assert.equal((await rows('PRODUCTO_MODIFICADO')).length, 0, 'Cambiar solo la descripción no se audita');
  await call(`/api/productos-menu/${product.idproducto_menu}`, { method: 'PUT', body: { ...product, precio_venta: Number(product.precio_venta) + 1000, stock_actual: 7 } });
  const [productoAudit] = await rows('PRODUCTO_MODIFICADO', product.idproducto_menu);
  assert.deepEqual(productoAudit.antes, { producto: 'Gaseosa', precio_venta: Number(product.precio_venta), stock_actual: Number(product.stock_actual) });
  assert.deepEqual(productoAudit.despues, { precio_venta: Number(product.precio_venta) + 1000, stock_actual: 7 });

  const ingredient = (await call('/api/ingredientes?pageSize=100')).items.find(item => item.nombre === 'Tomate');
  await call(`/api/ingredientes/${ingredient.idingrediente}`, { method: 'PUT', body: { ...ingredient, precio_compra: Number(ingredient.precio_compra) + 250 } });
  const [ingredienteAudit] = await rows('INGREDIENTE_MODIFICADO', ingredient.idingrediente);
  assert.deepEqual(ingredienteAudit.despues, { precio_compra: Number(ingredient.precio_compra) + 250 });
  assert.equal(ingredienteAudit.antes.ingrediente, 'Tomate');
  await call('/api/ingredientes/999999', { method: 'PUT', body: { ...ingredient }, status: 404 });

  // --- Usuarios, roles y permisos (la contraseña nunca se guarda)
  const roleMozo = (await pool.query("SELECT idusuario_rol FROM usuario_rol WHERE rol='mozo'")).rows[0].idusuario_rol;
  const newUser = (await call('/api/usuarios', { method: 'POST', body: { login: 'cajero1', nombre: 'Cajero Uno', fk_idusuario_rol: roleMozo, password: 'ClaveSegura123', activo: true } })).item;
  const [userCreated] = await rows('USUARIO_CREADO', newUser.idusuario);
  assert.deepEqual(userCreated.despues, { login: 'cajero1', nombre: 'Cajero Uno', rol: 'mozo', activo: true });
  await call(`/api/usuarios/${newUser.idusuario}`, { method: 'PUT', body: { login: 'cajero1', nombre: 'Cajero Uno', fk_idusuario_rol: roleMozo, password: 'OtraClave4567', activo: false } });
  const [userChanged] = await rows('USUARIO_MODIFICADO', newUser.idusuario);
  assert.deepEqual(userChanged.antes, { activo: true });
  assert.deepEqual(userChanged.despues, { activo: false, contrasena: 'cambiada' });
  const allText = JSON.stringify((await pool.query('SELECT antes, despues FROM auditoria')).rows);
  assert.ok(!allText.includes('OtraClave4567') && !allText.includes('ClaveSegura123') && !allText.includes('$2a$'), 'Ni la contraseña ni su hash quedan en la auditoría');

  const role = (await call('/api/roles', { method: 'POST', body: { rol: 'caja', permisos: ['FORM_CAJA', 'FORM_MESAS'], activo: true } })).item;
  assert.deepEqual((await rows('ROL_CREADO', role.idusuario_rol))[0].despues, { rol: 'caja', activo: true, permisos: ['FORM_CAJA', 'FORM_MESAS'] });
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'caja', permisos: ['FORM_CAJA', 'FORM_PEDIDOS'], activo: true } });
  const [roleChanged] = await rows('ROL_MODIFICADO', role.idusuario_rol);
  assert.deepEqual([roleChanged.antes, roleChanged.despues], [{ permisos_quitados: ['FORM_MESAS'] }, { permisos_agregados: ['FORM_PEDIDOS'] }]);
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'caja', permisos: ['FORM_PEDIDOS', 'FORM_CAJA'], activo: true } });
  assert.equal((await rows('ROL_MODIFICADO', role.idusuario_rol)).length, 1, 'Guardar el rol sin cambios no se audita');

  const permiso = (await pool.query("SELECT idusuario_rol_evento, nombre, descripcion FROM usuario_rol_evento WHERE codigo_evento='FORM_CAJA'")).rows[0];
  await call(`/api/permisos/${permiso.idusuario_rol_evento}`, { method: 'PUT', body: { nombre: 'Caja', descripcion: permiso.descripcion, activo: true } });
  const [permisoAudit] = await rows('PERMISO_MODIFICADO', permiso.idusuario_rol_evento);
  assert.deepEqual([permisoAudit.antes, permisoAudit.despues], [{ codigo: 'FORM_CAJA', nombre: permiso.nombre }, { nombre: 'Caja' }]);

  // --- Cierre de caja con diferencia en efectivo (antes, sin pedidos pendientes de cobro)
  await call(`/api/pedidos/${created.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Cierre de prueba', devoluciones: [] } });
  await call('/api/cajas/abrir', { method: 'POST', body: { clave: randomUUID(), monto_inicial: 10000 } });
  const box = (await call('/api/cajas')).abierta;
  const detail = await call(`/api/cajas/${box.idcaja_gral}`);
  const counts = Object.fromEntries(detail.arqueos.map(row => [row.fk_idforma_pago, Number(row.monto_esperado)]));
  const cash = detail.efectivo.idforma_pago;
  counts[cash] -= 3000;
  await call(`/api/cajas/${box.idcaja_gral}/cerrar`, { method: 'POST', body: { clave: randomUUID(), conteos: counts } });
  const [cierre] = await rows('CAJA_CIERRE_DIFERENCIA', box.idcaja_gral);
  const forma = Object.keys(cierre.despues)[0];
  assert.equal(cierre.despues[forma].diferencia, -3000);
  assert.equal(cierre.antes[forma].esperado, counts[cash] + 3000);

  // --- Consulta: filtros, paginado y Excel
  const all = await call('/api/auditoria?pageSize=25');
  assert.equal(all.total, await count());
  assert.ok(all.items[0].idauditoria > all.items[all.items.length - 1].idauditoria, 'Más recientes primero');
  assert.ok(all.acciones.PEDIDO_ANULADO && all.usuarios.includes('admin'));
  assert.equal((await call('/api/auditoria?accion=PEDIDO_ANULADO')).total, 2);
  const byOrder = await call(`/api/auditoria?entidad=pedido&id=${created.idpedido}`);
  assert.deepEqual(byOrder.items.map(item => item.accion).sort(), ['PEDIDO_ANULADO', 'PEDIDO_DESCUENTO', 'PEDIDO_LINEA_ANULADA', 'PEDIDO_LINEA_REDUCIDA', 'PEDIDO_PRECIO_MANUAL']);
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  assert.equal((await call(`/api/auditoria?desde=${today}&hasta=${today}`)).total, all.total);
  assert.equal((await call('/api/auditoria?desde=2000-01-01&hasta=2000-01-02')).total, 0);
  await call('/api/auditoria?accion=INVENTADA', { status: 400 });
  await call('/api/auditoria?desde=2026-13-01', { status: 400 });
  await call('/api/auditoria?id=abc', { status: 400 });
  await call('/api/auditoria?usuario=nadie&accion=PEDIDO_ANULADO').then(data => assert.equal(data.total, 0));
  const excel = await call('/api/auditoria/reporte.xlsx?accion=PEDIDO_ANULADO', { raw: true });
  assert.match(excel.headers.get('content-type'), /spreadsheetml/);
  const bytes = Buffer.from(await excel.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK', 'El Excel es un .xlsx válido (zip)');
  await call('/api/auditoria/reporte.xlsx', { role: 'mozo', status: 403 });

  // --- Inmutable: no se puede editar ni borrar
  await assert.rejects(pool.query('UPDATE auditoria SET motivo=$1', ['x']), /no se puede modificar/);
  await assert.rejects(pool.query('DELETE FROM auditoria'), /no se puede modificar/);
  await assert.rejects(pool.query('TRUNCATE auditoria'), /no se puede modificar/);
  assert.equal((await call('/api/auditoria')).total, all.total);

  console.log(`PASS: auditoría de pedidos, precios, stock, usuarios, roles, permisos y caja; filtros, Excel e inmutabilidad (${all.total} registros).`);
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
