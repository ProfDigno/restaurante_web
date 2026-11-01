// Verificación HTTP en un esquema temporal aislado de los datos reales.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { pool } from '../src/config/database.js';

const schema = `test_security_${Date.now()}`;
assert.match(schema, /^test_security_[0-9]+$/);
const adminDb = new pg.Client(pool.options);
await adminDb.connect();
let server;
try {
  await adminDb.query(`CREATE SCHEMA "${schema}"`);
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
  const users = (await pool.query("SELECT u.idusuario,r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const cookie = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession(user)}`]));
  async function call(path, { method = 'GET', body, as = 'admin', status = 200 } = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie[as] }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  }
  const admin = await call('/api/auth/me');
  assert.equal(admin.user.permisos.filter(code => code.startsWith('FORM_')).length, 27);
  assert.deepEqual(admin.menu.map(section => section.label), ['Operación', 'Usuarios', 'Cliente', 'Productos', 'Mesas', 'Caja y finanzas', 'Gasto', 'Compra']);
  assert.deepEqual(admin.menu.map(section => section.items.map(item => item.id)), [
    ['mesas', 'historial-mesas', 'pedidos', 'comanda', 'kpi-pedidos'],
    ['usuarios', 'roles', 'permisos'],
    ['clientes', 'zonas', 'delivery'],
    ['categorias', 'menu', 'grupos', 'unidades-menu', 'ingredientes', 'unidades-medida', 'conversiones-unidad'],
    ['ubicaciones-mesa', 'mesas-config'],
    ['caja', 'formas-pago'],
    ['gastos', 'kpi-gastos', 'gasto-tipos'],
    ['compras', 'proveedores']
  ]);
  const waiter = await call('/api/auth/me', { as: 'mozo' });
  assert.deepEqual(waiter.user.permisos.filter(code => code.startsWith('FORM_')).sort(), ['FORM_COMANDA', 'FORM_MESAS', 'FORM_PEDIDOS']);
  assert.deepEqual(waiter.menu.map(section => section.label), ['Operación']);
  assert.deepEqual(waiter.menu.flatMap(section => section.items.map(item => item.id)).sort(), ['comanda', 'mesas', 'pedidos']);
  await call('/api/pedidos', { as: 'mozo' });
  await call('/api/mesas/historial', { as: 'mozo', status: 403 });
  const history = await call('/api/mesas/historial');
  assert.equal(history.total, 0);
  await call('/api/kpi-pedidos?inicio=2026-10-01&fin=2026-10-17', { as: 'mozo', status: 403 });
  await call('/api/kpi-pedidos?inicio=2026-10-18&fin=2026-10-17', { status: 400 });
  const emptyKpi = await call('/api/kpi-pedidos?inicio=2026-10-01&fin=2026-10-03');
  assert.equal(emptyKpi.dias.length, 3);
  assert.equal(emptyKpi.resumen.pedidos, 0);
  await call('/api/productos-menu', { as: 'mozo', status: 403 });
  await call('/api/usuarios', { as: 'mozo', status: 403 });
  await call('/api/cajas/estado', { as: 'mozo' });
  await call('/api/cajas/abrir', { as: 'mozo', method: 'POST', body: { monto_inicial: 10000, clave: randomUUID() } });
  await call('/api/gastos', { as: 'mozo', status: 403 });
  await call('/api/compras', { as: 'mozo', status: 403 });
  await call('/api/proveedores', { as: 'mozo', status: 403 });
  await call('/api/kpi-gastos?inicio=2026-10-17&fin=2026-10-17', { as: 'mozo', status: 403 });
  await call('/api/kpi-gastos?inicio=2026-10-18&fin=2026-10-17', { status: 400 });
  const emptyExpenseKpi=await call('/api/kpi-gastos?inicio=2026-10-17&fin=2026-10-19');
  assert.equal(emptyExpenseKpi.dias.length,3); assert.equal(emptyExpenseKpi.resumen.cantidad,0);
  await call('/api/gasto-tipos', { as: 'mozo', status: 403 });
  await call('/api/gasto-tipos');
  const cashForm = (await call('/api/gastos/opciones')).formas.find(item => item.nombre === 'Efectivo');
  const secondForm=(await call('/api/compras/opciones')).formas.find(item=>item.idforma_pago!==cashForm.idforma_pago);
  const newKind = (await call('/api/gasto-tipos', { method: 'POST', body: { nombre: 'Prueba gasto', activo: true, clave: randomUUID() } })).item;
  assert.ok(newKind.orden > 0);
  await call(`/api/gasto-tipos/${newKind.idgasto_tipo}/orden`, { method: 'POST', body: { direction: 'up', clave: randomUUID() } });
  const expenseBody={ fecha_gasto: '2026-10-17', fk_idgasto_tipo: newKind.idgasto_tipo, fk_idforma_pago: cashForm.idforma_pago, descripcion: 'Gasto de prueba', total_gasto: 1000, clave: randomUUID() };
  const expense = (await call('/api/gastos', { method: 'POST', body: expenseBody })).item;
  assert.equal((await call('/api/gastos', { method: 'POST', body: expenseBody })).item.idgasto,expense.idgasto);
  assert.equal(expense.estado, 'pagado');
  const cashItem = await pool.query('SELECT tipo_movimiento,monto_gasto FROM caja_item WHERE fk_idgasto=$1 AND NOT es_reversion',[expense.idgasto]);
  assert.equal(cashItem.rowCount,1); assert.equal(cashItem.rows[0].tipo_movimiento,'egreso');
  assert.equal(Number(cashItem.rows[0].monto_gasto),1000);
  const expenseKpi=await call('/api/kpi-gastos?inicio=2026-10-17&fin=2026-10-17');
  assert.equal(expenseKpi.resumen.cantidad,1); assert.equal(expenseKpi.resumen.monto,1000);
  assert.equal(expenseKpi.dias[0].cantidad,1); assert.equal(expenseKpi.tipos.find(row=>row.id===newKind.idgasto_tipo).monto,1000);
  assert.equal(expenseKpi.formas.find(row=>row.id===cashForm.idforma_pago).monto,1000);
  await pool.query("INSERT INTO gasto(fk_idgasto_tipo,fk_idforma_pago,fecha_gasto,descripcion,total_gasto,estado,creado_por) VALUES($1,$2,'2026-10-17','Pendiente heredado',700,'pendiente','PRUEBA')",[newKind.idgasto_tipo,cashForm.idforma_pago]);
  assert.equal((await call('/api/kpi-gastos?inicio=2026-10-17&fin=2026-10-17')).resumen.monto,1000);
  assert.equal(Number((await call('/api/cajas')).abierta.total_egresos),1000);
  await call(`/api/gastos/${expense.idgasto}/anular`, { method: 'POST', body: { motivo: 'Corrección', clave: randomUUID() } });
  await call(`/api/gastos/${expense.idgasto}/anular`, { method: 'POST', body: { motivo: 'Duplicado', clave: randomUUID() }, status: 409 });
  const reversed = await pool.query('SELECT tipo_movimiento FROM caja_item WHERE fk_idgasto=$1 AND es_reversion',[expense.idgasto]);
  assert.equal(reversed.rowCount,1); assert.equal(reversed.rows[0].tipo_movimiento,'ingreso');
  const cancelledKpi=await call('/api/kpi-gastos?inicio=2026-10-17&fin=2026-10-17');
  assert.equal(cancelledKpi.resumen.cantidad,0); assert.equal(cancelledKpi.resumen.monto,0);
  assert.equal(cancelledKpi.resumen.anulados.cantidad,1); assert.equal(cancelledKpi.resumen.anulados.monto,1000);
  assert.equal(Number((await call('/api/cajas')).abierta.total_egresos),1000);
  assert.equal(Number((await call('/api/cajas')).abierta.total_ingresos),1000);
  await call(`/api/gasto-tipos/${newKind.idgasto_tipo}`, { method: 'PUT', body: { nombre: newKind.nombre, activo: false, clave: randomUUID() } });
  await call('/api/gastos', { method: 'POST', body: { fecha_gasto: '2026-10-17', fk_idgasto_tipo: newKind.idgasto_tipo, fk_idforma_pago: cashForm.idforma_pago, descripcion: 'No permitido', total_gasto: 1000, clave: randomUUID() }, status: 400 });
  const noExpenseForm=(await pool.query("INSERT INTO forma_pago(nombre,es_ingreso,es_egreso,activo,creado_por) VALUES('Solo ingresos',true,false,true,'PRUEBA') RETURNING idforma_pago")).rows[0].idforma_pago;
  await call('/api/gastos', { method: 'POST', body: { fecha_gasto: '2026-10-17', fk_idgasto_tipo: 1, fk_idforma_pago: noExpenseForm, descripcion: 'No permitido', total_gasto: 1000, clave: randomUUID() }, status: 400 });

  const supplier=(await call('/api/compras/proveedores?search=Proveedor')).items[0];
  const product=(await call('/api/compras/productos?search=Gaseosa')).items[0];
  assert.ok(supplier?.idproveedor&&product?.nombre.split(' · ').length===3);
  const stockBefore=Number((await pool.query('SELECT stock_actual FROM producto_menu WHERE idproducto_menu=$1',[product.idproducto_menu])).rows[0].stock_actual);
  const purchaseBody={fk_idproveedor:supplier.idproveedor,fecha_compra:'2026-10-17',condicion:'CREDITO',numero_nota:'T-1',detalles:[{fk_idproducto_menu:product.idproducto_menu,cantidad:2,precio_compra:800}],clave:randomUUID()};
  const draft=(await call('/api/compras',{method:'POST',body:purchaseBody})).compra;
  assert.equal((await call('/api/compras',{method:'POST',body:purchaseBody})).compra.idcompra,draft.idcompra);
  assert.equal(draft.estado,'borrador');assert.equal(draft.total_borrador,1600);
  assert.equal(Number((await pool.query('SELECT stock_actual FROM producto_menu WHERE idproducto_menu=$1',[product.idproducto_menu])).rows[0].stock_actual),stockBefore);
  const received=(await call(`/api/compras/${draft.idcompra}/recibir`,{method:'POST',body:{anticipo:500,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()}})).compra;
  assert.equal(received.estado,'recibida');assert.equal(received.saldo,1100);assert.equal(received.pagos.length,1);
  assert.equal(Number((await pool.query('SELECT stock_actual FROM producto_menu WHERE idproducto_menu=$1',[product.idproducto_menu])).rows[0].stock_actual),stockBefore+2);
  await call(`/api/compras/${draft.idcompra}/pagos`,{method:'POST',body:{importe:1200,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()},status:400});
  const finalPayment={importe:1100,fk_idforma_pago:secondForm.idforma_pago,clave:randomUUID()};
  const settled=(await call(`/api/compras/${draft.idcompra}/pagos`,{method:'POST',body:finalPayment})).compra;
  assert.equal((await call(`/api/compras/${draft.idcompra}/pagos`,{method:'POST',body:finalPayment})).compra.pagos.length,2);
  assert.equal(settled.estado_pago,'pagada');assert.equal(settled.saldo,0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM caja_item WHERE fk_idcompra_pago IN (SELECT idcompra_pago FROM compra_pago WHERE fk_idcompra=$1) AND NOT es_reversion',[draft.idcompra])).rows[0].n,2);
  const cancelled=(await call(`/api/compras/${draft.idcompra}/anular`,{method:'POST',body:{motivo:'Prueba de anulación',clave:randomUUID()}})).compra;
  assert.equal(cancelled.estado,'cancelada');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM caja_item WHERE fk_idcompra_pago IN (SELECT idcompra_pago FROM compra_pago WHERE fk_idcompra=$1) AND es_reversion',[draft.idcompra])).rows[0].n,2);
  assert.equal(Number((await pool.query('SELECT stock_actual FROM producto_menu WHERE idproducto_menu=$1',[product.idproducto_menu])).rows[0].stock_actual),stockBefore);
  const initialPaymentBody={...purchaseBody,numero_nota:'T-INICIAL',confirmar:true,anticipo:500,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()};
  const initialPurchase=(await call('/api/compras',{method:'POST',body:initialPaymentBody})).compra;
  assert.equal(initialPurchase.estado,'recibida');assert.equal(initialPurchase.saldo,1100);assert.equal(initialPurchase.pagos.length,1);
  assert.equal((await call('/api/compras',{method:'POST',body:initialPaymentBody})).compra.idcompra,initialPurchase.idcompra);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM caja_item WHERE fk_idcompra_pago=$1 AND NOT es_reversion',[initialPurchase.pagos[0].idcompra_pago])).rows[0].n,1);
  await call(`/api/compras/${initialPurchase.idcompra}/anular`,{method:'POST',body:{motivo:'Prueba de pago inicial',clave:randomUUID()}});
  const purchaseCount=Number((await pool.query('SELECT count(*) AS n FROM compra')).rows[0].n);
  await call('/api/compras',{method:'POST',body:{...purchaseBody,numero_nota:'BORRADOR-CON-PAGO',anticipo:500,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()},status:400});
  await call('/api/compras',{method:'POST',body:{...purchaseBody,numero_nota:'SIN-FORMA',confirmar:true,anticipo:500,clave:randomUUID()},status:400});
  assert.equal(Number((await pool.query('SELECT count(*) AS n FROM compra')).rows[0].n),purchaseCount);
  const initialCash=(await call('/api/compras',{method:'POST',body:{...purchaseBody,condicion:'CONTADO',numero_nota:'T-CONTADO-INICIAL',confirmar:true,anticipo:0,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()}})).compra;
  assert.equal(initialCash.estado_pago,'pagada');assert.equal(initialCash.saldo,0);assert.equal(initialCash.pagos.length,1);
  await call(`/api/compras/${initialCash.idcompra}/anular`,{method:'POST',body:{motivo:'Prueba de contado inicial',clave:randomUUID()}});
  const cashDraft=(await call('/api/compras',{method:'POST',body:{...purchaseBody,condicion:'CONTADO',numero_nota:'T-2',clave:randomUUID()}})).compra;
  const cashReceived=(await call(`/api/compras/${cashDraft.idcompra}/recibir`,{method:'POST',body:{fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()}})).compra;
  assert.equal(cashReceived.estado_pago,'pagada');assert.equal(cashReceived.pagos.length,1);
  const stockAfterCash=Number((await pool.query('SELECT stock_actual FROM producto_menu WHERE idproducto_menu=$1',[product.idproducto_menu])).rows[0].stock_actual);
  await pool.query('UPDATE producto_menu SET stock_actual=0 WHERE idproducto_menu=$1',[product.idproducto_menu]);
  await call(`/api/compras/${cashDraft.idcompra}/anular`,{method:'POST',body:{motivo:'Sin stock',clave:randomUUID()},status:400});
  assert.equal((await call(`/api/compras/${cashDraft.idcompra}`)).estado,'recibida');
  await pool.query('UPDATE producto_menu SET stock_actual=$1 WHERE idproducto_menu=$2',[stockAfterCash,product.idproducto_menu]);
  const creditDraft=(await call('/api/compras',{method:'POST',body:{...purchaseBody,numero_nota:'T-3',clave:randomUUID()}})).compra;
  const creditReceived=(await call(`/api/compras/${creditDraft.idcompra}/recibir`,{method:'POST',body:{anticipo:0,clave:randomUUID()}})).compra;
  assert.equal(creditReceived.importe_pagado,'0'); assert.equal(creditReceived.pagos.length,0);
  const legacyDraft=(await call('/api/compras',{method:'POST',body:{...purchaseBody,numero_nota:'T-L',clave:randomUUID()}})).compra;
  await call(`/api/compras/${legacyDraft.idcompra}/recibir`,{method:'POST',body:{anticipo:0,clave:randomUUID()}});
  await pool.query('SELECT pagar_compra($1,$2,$3)',[legacyDraft.idcompra,cashForm.idforma_pago,'PRUEBA']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM caja_item WHERE fk_idcompra=$1 AND NOT es_reversion',[legacyDraft.idcompra])).rows[0].n,1);
  await call(`/api/compras/${legacyDraft.idcompra}/anular`,{method:'POST',body:{motivo:'Compra histórica',clave:randomUUID()}});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM caja_item WHERE fk_idcompra=$1 AND es_reversion',[legacyDraft.idcompra])).rows[0].n,1);
  const inactiveSupplier=(await call('/api/proveedores',{method:'POST',body:{nombre:'Proveedor inactivo',activo:false,clave:randomUUID()}})).item;
  await call('/api/compras',{method:'POST',body:{...purchaseBody,fk_idproveedor:inactiveSupplier.idproveedor,clave:randomUUID()},status:400});
  await pool.query('UPDATE producto_menu SET es_comprar=false WHERE idproducto_menu=$1',[product.idproducto_menu]);
  await call('/api/compras',{method:'POST',body:{...purchaseBody,clave:randomUUID()},status:400});
  await pool.query('UPDATE producto_menu SET es_comprar=true WHERE idproducto_menu=$1',[product.idproducto_menu]);

  const role = (await call('/api/roles', { method: 'POST', body: { rol: 'prueba', permisos: ['FORM_MESAS'], activo: true } })).item;
  const created = (await call('/api/usuarios', { method: 'POST', body: { login: 'prueba', nombre: 'Usuario de prueba', password: 'clave-segura-123', fk_idusuario_rol: role.idusuario_rol, activo: true } })).item;
  assert.equal(created.password_hash, undefined);
  const login = await call('/api/auth/login', { method: 'POST', body: { login: 'prueba', password: 'clave-segura-123' } });
  assert.deepEqual(login.user.permisos.filter(code => code.startsWith('FORM_')), ['FORM_MESAS']);
  await call(`/api/usuarios/${created.idusuario}`, { method: 'PUT', body: { ...created, password: 'nueva-clave-123' } });
  await call('/api/auth/login', { method: 'POST', body: { login: 'prueba', password: 'clave-segura-123' }, status: 401 });
  await call('/api/auth/login', { method: 'POST', body: { login: 'prueba', password: 'nueva-clave-123' } });
  cookie.prueba = `restaurante_token=${signSession({ idusuario: created.idusuario })}`;
  await call('/api/pedidos', { as: 'prueba', status: 403 });
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'prueba', permisos: ['FORM_MESAS', 'FORM_PEDIDOS', 'FORM_MENU'], activo: true } });
  assert.ok((await call('/api/auth/me', { as: 'prueba' })).user.permisos.includes('FORM_PEDIDOS'));
  await call('/api/pedidos', { as: 'prueba' });
  await call('/api/productos-menu', { as: 'prueba' });
  await call('/api/categorias-menu', { as: 'prueba' });
  await call('/api/categorias-menu', { as: 'prueba', method: 'POST', body: {}, status: 403 });
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'prueba', permisos: ['FORM_MESAS', 'FORM_PEDIDOS', 'FORM_MENU'], activo: false } });
  await call('/api/auth/me', { as: 'prueba', status: 401 });
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'prueba', permisos: ['FORM_MESAS', 'FORM_PEDIDOS', 'FORM_MENU'], activo: true } });
  await call(`/api/roles/${role.idusuario_rol}`, { method: 'PUT', body: { rol: 'prueba', permisos: ['FORM_CATEGORIAS'], activo: true } });
  const categoryId = (await pool.query('SELECT idcategoria_menu FROM categoria_menu ORDER BY idcategoria_menu LIMIT 1')).rows[0].idcategoria_menu;
  await call(`/api/categorias-menu/${categoryId}/productos`, { as: 'prueba' });
  await call('/api/productos-menu', { as: 'prueba', status: 403 });

  const adminRole = (await call('/api/roles')).items.find(item => item.rol === 'admin');
  await call(`/api/roles/${adminRole.idusuario_rol}`, { method: 'PUT', body: { rol: 'admin', permisos: adminRole.permisos.filter(code => code !== 'FORM_ROLES'), activo: true }, status: 409 });
  const permissions = await call('/api/permisos?pageSize=100');
  const security = permissions.items.find(item => item.codigo_evento === 'FORM_PERMISOS');
  await call(`/api/permisos/${security.idusuario_rol_evento}`, { method: 'PUT', body: { nombre: security.nombre, descripcion: security.descripcion, activo: false }, status: 409 });
  await call(`/api/permisos/${security.idusuario_rol_evento}`, { method: 'PUT', body: { nombre: 'Permisos de acceso', descripcion: 'Gestión del catálogo', activo: true } });
  await call(`/api/usuarios/${created.idusuario}`, { method: 'PUT', body: { ...created, activo: false, password: '' } });
  await call('/api/auth/me', { as: 'prueba', status: 401 });
  const openBox=(await call('/api/cajas')).abierta;
  const boxDetail=await call(`/api/cajas/${openBox.idcaja_gral}`);
  const counts=Object.fromEntries(boxDetail.arqueos.map(row=>[row.fk_idforma_pago,Number(row.monto_esperado)]));
  await call(`/api/cajas/${openBox.idcaja_gral}/cerrar`, { method:'POST',body:{conteos:counts,clave:randomUUID()} });
  await call('/api/gastos', { method:'POST',body:{fecha_gasto:'2026-10-17',fk_idgasto_tipo:1,fk_idforma_pago:cashForm.idforma_pago,descripcion:'Sin caja',total_gasto:1000,clave:randomUUID()},status:400 });
  await call(`/api/compras/${creditDraft.idcompra}/pagos`,{method:'POST',body:{importe:100,fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()},status:400});
  const closedDraft=(await call('/api/compras',{method:'POST',body:{...purchaseBody,condicion:'CONTADO',numero_nota:'T-4',clave:randomUUID()}})).compra;
  await call(`/api/compras/${closedDraft.idcompra}/recibir`,{method:'POST',body:{fk_idforma_pago:cashForm.idforma_pago,clave:randomUUID()},status:400});
  assert.equal((await call(`/api/compras/${closedDraft.idcompra}`)).estado,'borrador');
  console.log('Permisos, usuarios, roles, sesiones y caja inicial verificados');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await adminDb.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await adminDb.end();
}
