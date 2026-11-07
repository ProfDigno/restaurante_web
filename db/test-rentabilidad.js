import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import pg from 'pg';
import { pool } from '../src/config/database.js';

// Análisis de rentabilidad: costo guardado al vender (producto, receta y agregados), productos sin costo,
// costo estimado, anulaciones, descuentos, filtro de categoría, período anterior, permisos, PDF y Excel.
const schema = `test_rentabilidad_${Date.now()}`;
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
  const users = (await pool.query("SELECT u.idusuario, r.rol FROM usuario u JOIN usuario_rol r ON r.idusuario_rol=u.fk_idusuario_rol WHERE r.rol IN ('admin','encargado','mozo')")).rows;
  const auth = Object.fromEntries(users.map(user => [user.rol, `restaurante_token=${signSession({ idusuario: user.idusuario })}`]));
  const call = async (path, { method = 'GET', role = 'admin', body, status = 200, raw = false } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(role ? { Cookie: auth[role] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (raw) { assert.equal(response.status, status); return response; }
    const data = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

  // --- Datos: Gaseosa con costo, Plato con receta y agregado, producto sin costo
  const clientId = (await q("SELECT idcliente FROM cliente WHERE ruc='20123456789'"))[0].idcliente;
  const [gaseosa] = await q("SELECT idproducto_menu AS id, precio_venta::int AS precio, fk_idcategoria_menu AS cat FROM producto_menu WHERE nombre='Gaseosa'");
  const [plato] = await q("SELECT idproducto_menu AS id, precio_venta::int AS precio, fk_idcategoria_menu AS cat FROM producto_menu WHERE nombre='Plato de la casa'");
  const [libre] = await q(`INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, stock_actual, activo, es_descontar_stock, es_cocina, es_vender, es_comprar)
    SELECT fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, 'Postre sin costo', 3000, 0, 100, true, false, false, true, false FROM producto_menu WHERE idproducto_menu=$1
    RETURNING idproducto_menu AS id, precio_venta::int AS precio, nombre`, [gaseosa.id]);
  await pool.query('UPDATE producto_menu SET precio_compra=600, stock_actual=100 WHERE idproducto_menu=$1', [gaseosa.id]);
  await pool.query('UPDATE producto_menu SET stock_actual=100 WHERE idproducto_menu=$1', [plato.id]);
  const [tomate] = await q("SELECT idingrediente AS id, fk_idunidad_medida AS unidad FROM ingrediente WHERE nombre='Tomate'");
  const [queso] = await q("SELECT idingrediente AS id FROM ingrediente WHERE nombre='Queso mozzarella'");
  await pool.query('UPDATE ingrediente SET precio_compra=4500, stock_actual=1000 WHERE idingrediente=$1', [tomate.id]);
  await pool.query('UPDATE ingrediente SET precio_compra=300, precio_venta=1000, stock_actual=1000 WHERE idingrediente=$1', [queso.id]);
  await pool.query('INSERT INTO receta(fk_idproducto_menu,fk_idingrediente,fk_idunidad_medida,cantidad) VALUES($1,$2,$3,1)', [plato.id, tomate.id, tomate.unidad]);
  await pool.query('INSERT INTO producto_menu_ingrediente(fk_idproducto_menu,fk_idingrediente,cantidad) VALUES($1,$2,2)', [plato.id, queso.id]);

  const order = async (detalles, extra = {}) => (await call('/api/pedidos', { method: 'POST', body: { clave: randomUUID(), tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, detalles, ...extra } })).pedido;
  const o1 = await order([{ fk_idproducto_menu: gaseosa.id, cantidad: 3 }, { fk_idproducto_menu: libre.id, cantidad: 1 }]);
  const o2 = await order([{ fk_idproducto_menu: plato.id, cantidad: 2, ingredientes: [{ idingrediente: queso.id, tipo_modificacion: 'AGREGAR' }] }],
    { monto_descuento: 500, motivo_descuento: 'Promo' });
  const cancelled = await order([{ fk_idproducto_menu: gaseosa.id, cantidad: 10 }]);
  await call(`/api/pedidos/${cancelled.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Prueba', devoluciones: [] } });

  // El costo del ingrediente queda guardado al vender, y no cambia si después sube el precio.
  const [snapshot] = await q('SELECT dpr.costo_unitario::int AS receta, dpi.costo_unitario::int AS agregado, dpi.precio_venta::int AS agregado_venta FROM detalle_pedido dp JOIN detalle_pedido_receta dpr ON dpr.fk_iddetalle_pedido=dp.iddetalle_pedido JOIN detalle_pedido_ingrediente dpi ON dpi.fk_iddetalle_pedido=dp.iddetalle_pedido WHERE dp.fk_idpedido=$1', [o2.idpedido]);
  assert.deepEqual([snapshot.receta, snapshot.agregado], [4500, 300]);
  await pool.query('UPDATE ingrediente SET precio_compra=9999 WHERE idingrediente=ANY($1::int[])', [[tomate.id, queso.id]]);

  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const path = (extra = '') => `/api/kpi-rentabilidad?inicio=${today}&fin=${today}${extra}`;

  // --- Permisos y validación
  await call(path(), { role: null, status: 401 });
  await call(path(), { role: 'mozo', status: 403 });
  await call(path(), { role: 'encargado' });
  await call(`/api/kpi-rentabilidad?inicio=${today}&fin=2000-01-01`, { status: 400 });
  await call(path('&categoria=abc'), { status: 400 });

  // --- Cálculo
  const data = await call(path());
  const g = data.productos.find(p => p.id === gaseosa.id), pl = data.productos.find(p => p.id === plato.id), li = data.productos.find(p => p.id === libre.id);
  assert.deepEqual([g.unidades, g.venta, g.costo, g.margen], [3, 3 * gaseosa.precio, 1800, 3 * gaseosa.precio - 1800], 'Anulados no cuentan; costo = 3 × 600');
  const platoVenta = 2 * plato.precio + 2 * snapshot.agregado_venta;
  assert.deepEqual([pl.unidades, pl.venta, pl.costo], [2, platoVenta, 2 * 4500 + 2 * 2 * 300], 'Receta y agregado con el costo guardado al vender, no el precio nuevo');
  assert.equal(pl.estimado, false);
  assert.ok(li.sin_costo && !li.costo_incompleto && li.costo === 0 && li.margen_pct === 100, 'Producto sin costo se marca');
  assert.ok(!g.sin_costo && !g.costo_incompleto);
  const s = data.resumen;
  assert.equal(s.pedidos, 2);
  assert.equal(s.venta, g.venta + pl.venta + li.venta);
  assert.equal(s.costo, 1800 + pl.costo);
  assert.equal(s.margen, s.venta - s.costo);
  assert.equal(s.descuentos, 500);
  assert.equal(s.margen_neto, s.margen - 500);
  assert.equal(s.productos_sin_costo, 1);
  assert.equal(s.venta_sin_costo, li.venta);
  assert.equal(s.lineas_estimadas, 0);
  assert.ok(Math.abs(s.margen_pct - s.margen / s.venta * 100) < 1e-9);
  assert.deepEqual(data.productos.map(p => p.margen), [...data.productos.map(p => p.margen)].sort((a, b) => b - a), 'Ordenado por margen');
  assert.equal(data.categorias.reduce((sum, c) => sum + c.venta, 0), s.venta, 'Las categorías suman la venta total');

  // Si el producto recibe costo después, sus ventas viejas quedan sin costo: "costo incompleto", no "sin costo".
  await pool.query('UPDATE producto_menu SET precio_compra=1000 WHERE idproducto_menu=$1', [libre.id]);
  const later = await order([{ fk_idproducto_menu: libre.id, cantidad: 1 }]);
  const partial = (await call(path())).productos.find(p => p.id === libre.id);
  assert.deepEqual([partial.sin_costo, partial.costo_incompleto, partial.costo], [false, true, 1000]);
  await call(`/api/pedidos/${later.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Prueba', devoluciones: [] } });

  // Un costo de relleno (1 Gs.) se marca como sospechoso y no entra en "menor margen %".
  const [relleno] = await q(`INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, stock_actual, activo, es_descontar_stock, es_cocina, es_vender, es_comprar)
    SELECT fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, 'Costo de relleno', 3000, 1, 100, true, false, false, true, false FROM producto_menu WHERE idproducto_menu=$1
    RETURNING idproducto_menu AS id`, [gaseosa.id]);
  const filler = await order([{ fk_idproducto_menu: relleno.id, cantidad: 2 }]);
  const flagged = await call(path());
  const fillerRow = flagged.productos.find(p => p.id === relleno.id);
  assert.deepEqual([fillerRow.costo, fillerRow.costo_sospechoso, fillerRow.sin_costo], [2, true, false]);
  assert.equal(flagged.resumen.productos_costo_sospechoso, 1);
  assert.equal(flagged.resumen.venta_costo_sospechoso, 6000);
  assert.ok(!flagged.productos.find(p => p.id === gaseosa.id).costo_sospechoso, 'Un costo real no es sospechoso');
  await call(`/api/pedidos/${filler.idpedido}/anular`, { method: 'POST', body: { clave: randomUUID(), motivo: 'Prueba', devoluciones: [] } });

  // Una línea quitada al editar deja de contar.
  const full = await call(`/api/pedidos/${o1.idpedido}`);
  const keep = full.detalles.find(d => d.fk_idproducto_menu === gaseosa.id);
  await call(`/api/pedidos/${o1.idpedido}`, { method: 'PUT', body: { clave: randomUUID(), tipo_entrega: 'BUSCAR', fk_idcliente: clientId, monto_descuento: 0, version_web: full.version_web,
    detalles: [{ iddetalle_pedido: keep.iddetalle_pedido, fk_idproducto_menu: gaseosa.id, cantidad: 3 }] } });
  const edited = await call(path());
  assert.ok(!edited.productos.some(p => p.id === libre.id));
  assert.equal(edited.resumen.productos_sin_costo, 0);

  // Ventas anteriores a la migración (sin costo guardado): se usa el precio actual y se marcan como estimado.
  await pool.query('UPDATE detalle_pedido_receta SET costo_unitario=NULL WHERE fk_iddetalle_pedido IN (SELECT iddetalle_pedido FROM detalle_pedido WHERE fk_idpedido=$1)', [o2.idpedido]);
  const estimated = (await call(path())).productos.find(p => p.id === plato.id);
  assert.equal(estimated.estimado, true);
  assert.equal(estimated.costo, 2 * 9999 + 2 * 2 * 300);
  // Con el tomate a 9999 el plato se vende por debajo del costo: se cuenta y no se oculta.
  const loss = await call(path());
  assert.ok(estimated.margen < 0);
  assert.equal(loss.resumen.productos_con_perdida, 1);
  assert.equal(loss.resumen.perdida, estimated.margen);
  assert.ok(loss.categorias.some(c => c.margen < 0), 'Una categoría con pérdida también se muestra');

  // Filtro de categoría: solo esa categoría y sin descuentos (son del pedido entero).
  const byCategory = await call(path(`&categoria=${plato.cat}`));
  assert.ok(byCategory.productos.every(p => p.categoria === byCategory.categorias[0].nombre));
  assert.equal(byCategory.resumen.descuentos, null);
  assert.equal(byCategory.resumen.margen_neto, null);
  assert.match(byCategory.filtro, /Categoría/);

  // Período anterior: el pedido de la Gaseosa se pasa al día anterior.
  await pool.query("UPDATE pedido SET fecha_confirmado=fecha_confirmado-INTERVAL '1 day' WHERE idpedido=$1", [o1.idpedido]);
  const moved = await call(path());
  assert.equal(moved.resumen.anterior.venta, 3 * gaseosa.precio);
  assert.equal(moved.resumen.anterior.costo, 1800);
  assert.ok(!moved.productos.some(p => p.id === gaseosa.id));

  // Período vacío.
  const empty = await call('/api/kpi-rentabilidad?inicio=2000-01-01&fin=2000-01-02');
  assert.deepEqual([empty.resumen.venta, empty.resumen.margen_pct, empty.productos.length], [0, 0, 0]);

  // --- Opciones, PDF y Excel
  assert.ok((await call('/api/kpi-rentabilidad/opciones')).categorias.some(c => c.id === plato.cat));
  const pdf = await call(`/api/kpi-rentabilidad/reporte.pdf?inicio=${today}&fin=${today}`, { raw: true });
  assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const emptyPdf = await call('/api/kpi-rentabilidad/reporte.pdf?inicio=2000-01-01&fin=2000-01-02', { raw: true });
  assert.equal(Buffer.from(await emptyPdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  const xlsx = await call(`/api/kpi-rentabilidad/reporte.xlsx?inicio=${today}&fin=${today}`, { raw: true });
  const zip = await JSZip.loadAsync(Buffer.from(await xlsx.arrayBuffer()));
  assert.ok(zip.file('xl/charts/chart1.xml') && zip.file('xl/charts/chart2.xml'), 'El Excel trae los gráficos');
  const sheets = await zip.file('xl/workbook.xml').async('string');
  assert.match(sheets, /name="Resumen"/); assert.match(sheets, /name="Productos"/);
  const emptyXlsx = await call('/api/kpi-rentabilidad/reporte.xlsx?inicio=2000-01-01&fin=2000-01-02', { raw: true });
  assert.ok((await JSZip.loadAsync(Buffer.from(await emptyXlsx.arrayBuffer()))).file('xl/workbook.xml'));
  await call(`/api/kpi-rentabilidad/reporte.xlsx?inicio=${today}&fin=${today}`, { role: 'mozo', status: 403 });

  console.log('PASS: rentabilidad por producto y categoría (costo al vender, receta, agregados, sin costo, estimado, anulados, descuentos, filtro, período anterior, PDF y Excel).');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
