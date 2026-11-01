import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pool } from '../src/config/database.js';

const schema = `test_comanda_${Date.now()}`;
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
  const { saveOrder } = await import('../src/services/pedidos.js');
  const { finishExpiredComandas } = await import('../src/services/comandas.js');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const users = (await pool.query("SELECT u.idusuario, u.login, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const user = { sub: users.find(item => item.rol === 'admin').idusuario, login: 'admin', permisos: ['FORM_PEDIDOS'] };
  const clientId = (await pool.query("SELECT idcliente FROM cliente WHERE ruc='20123456789'")).rows[0].idcliente;
  const kitchenId = (await pool.query("SELECT idproducto_menu FROM producto_menu WHERE nombre='Plato de la casa'")).rows[0].idproducto_menu;
  await pool.query('UPDATE producto_menu SET stock_actual=100 WHERE idproducto_menu=$1', [kitchenId]);
  const drinkId = (await pool.query("SELECT idproducto_menu FROM producto_menu WHERE nombre='Gaseosa'")).rows[0].idproducto_menu;
  const ingredients = (await pool.query("SELECT idingrediente, nombre FROM ingrediente WHERE nombre IN ('Tomate','Queso mozzarella') ORDER BY nombre")).rows;
  for (const ingredient of ingredients) await pool.query('INSERT INTO producto_menu_ingrediente(fk_idproducto_menu,fk_idingrediente,cantidad) VALUES($1,$2,1)', [kitchenId, ingredient.idingrediente]);
  const body = detalles => ({ tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, detalles });
  const kitchenLine = { fk_idproducto_menu: kitchenId, cantidad: 2, ingredientes: [
    { idingrediente: ingredients[0].idingrediente, tipo_modificacion: 'QUITAR' },
    { idingrediente: ingredients[1].idingrediente, tipo_modificacion: 'AGREGAR' }
  ] };
  const first = (await saveOrder(pool, body([kitchenLine, { fk_idproducto_menu: drinkId, cantidad: 1 }]), user)).pedido;
  const noKitchen = (await saveOrder(pool, body([{ fk_idproducto_menu: drinkId, cantidad: 1 }]), user)).pedido;
  const expired = (await saveOrder(pool, body([{ fk_idproducto_menu: kitchenId, cantidad: 1 }]), user)).pedido;

  const call = async (path, { method = 'GET', role = 'admin', body: payload, status = 200 } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    const data = await response.json();
    assert.equal(response.status, status, JSON.stringify(data));
    return data;
  };
  await call('/api/comandas', { role: null, status: 401 });
  const initial = await call('/api/comandas', { role: 'mozo' });
  assert.deepEqual(initial.items.map(item => item.idpedido), [first.idpedido, expired.idpedido]);
  assert.equal(initial.items[0].detalles.length, 1);
  assert.equal(initial.items[0].detalles[0].cantidad, 2);
  assert.equal(initial.items[0].detalles[0].categoria, 'Platos principales');
  assert.equal(initial.items[0].detalles[0].unidad, 'Porción');
  assert.ok(!('ingredientes' in initial.items[0].detalles[0]));
  assert.equal(initial.items[0].detalles[0].agregados.length, 1);
  assert.equal(initial.items[0].detalles[0].quitados.length, 1);
  assert.ok(!JSON.stringify(initial).includes('precio_venta'));
  assert.ok(!JSON.stringify(initial).includes('monto_total'));

  await call(`/api/comandas/${first.idpedido}/terminar`, { method: 'POST', body: { clave: randomUUID(), version_web: first.version_web } });
  assert.equal((await pool.query('SELECT estado FROM pedido WHERE idpedido=$1', [first.idpedido])).rows[0].estado, 'listo');

  await pool.query("UPDATE pedido SET fecha_creado=LOCALTIMESTAMP-INTERVAL '61 minutes' WHERE idpedido=ANY($1::int[])", [[noKitchen.idpedido, expired.idpedido]]);
  await finishExpiredComandas();
  const states = (await pool.query('SELECT idpedido,estado FROM pedido WHERE idpedido=ANY($1::int[])', [[noKitchen.idpedido, expired.idpedido]])).rows;
  assert.equal(states.find(item => item.idpedido === noKitchen.idpedido).estado, 'en_preparacion');
  assert.equal(states.find(item => item.idpedido === expired.idpedido).estado, 'listo');

  const cancelled = (await saveOrder(pool, body([{ fk_idproducto_menu: kitchenId, cantidad: 1 }]), user)).pedido;
  await call(`/api/pedidos/${cancelled.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Prueba', devoluciones: [] } });
  assert.ok((await call('/api/comandas')).items.some(item => item.idpedido === cancelled.idpedido && item.estado === 'cancelado'));
  await pool.query("UPDATE pedido SET fecha_anulado=LOCALTIMESTAMP-INTERVAL '31 seconds' WHERE idpedido=$1", [cancelled.idpedido]);
  assert.ok(!(await call('/api/comandas')).items.some(item => item.idpedido === cancelled.idpedido));
  console.log('PASS: Comanda, permisos, ingredientes, anulación y finalización automática.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
