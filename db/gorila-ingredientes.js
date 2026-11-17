// Ingredientes del sistema anterior (Gorila / SisDaoSamu3) → ingredientes del producto en el sistema nuevo.
//
// En el sistema anterior:
//   producto_ingrediente (id, nombre, precio_venta)       → ingredientes que se pueden AGREGAR (con su precio) o QUITAR
//   item_producto_ingrediente (fk_idproducto, fk_idproducto_ingrediente) → qué ingredientes lleva cada producto
// En el sistema nuevo:
//   ingrediente (nombre único, unidad, precio_venta)       → mismo concepto; AGREGAR cobra precio_venta
//   producto_menu_ingrediente (producto, ingrediente, cantidad) → lista AGREGAR/QUITAR del detalle del pedido
//
// La importación es idempotente: reutiliza los ingredientes que ya existen con el mismo nombre (sin tocar sus
// datos) y no duplica vínculos, así se puede aplicar sobre una base que ya está en uso.

const clean = v => String(v ?? '').trim().replace(/\s+/g, ' ');
const key = v => clean(v).toLowerCase();

export async function readIngredientes(client) {
  const q = async sql => (await client.query(sql)).rows;
  return {
    ingredientes: await q('SELECT idproducto_ingrediente id, nombre, precio_venta FROM producto_ingrediente ORDER BY idproducto_ingrediente'),
    vinculos: await q('SELECT iditem_producto_ingrediente id, fk_idproducto producto, fk_idproducto_ingrediente ingrediente FROM item_producto_ingrediente ORDER BY iditem_producto_ingrediente')
  };
}

// Normaliza en memoria: descarta el registro "sin-dato" (id 0) y unifica nombres repetidos.
export function prepareIngredientes(src) {
  const avisos = { sin_dato: 0, nombres_repetidos: [], vinculos_sin_ingrediente: 0, vinculos_repetidos: 0 };
  const porNombre = new Map(); // key → { nombre, precio_venta }
  const canon = new Map();     // id anterior → key
  for (const r of src.ingredientes) {
    const nombre = clean(r.nombre).slice(0, 120);
    if (Number(r.id) === 0 || !nombre || key(nombre) === 'sin-dato') { avisos.sin_dato++; continue; }
    const k = key(nombre);
    const precio = Math.max(0, Math.round(Number(r.precio_venta || 0)));
    if (porNombre.has(k)) {
      avisos.nombres_repetidos.push(nombre);
      porNombre.get(k).precio_venta = Math.max(porNombre.get(k).precio_venta, precio);
    } else porNombre.set(k, { nombre, precio_venta: precio });
    canon.set(Number(r.id), k);
  }
  const vistos = new Set();
  const vinculos = [];
  for (const v of src.vinculos) {
    const k = canon.get(Number(v.ingrediente));
    if (!k) { avisos.vinculos_sin_ingrediente++; continue; }
    const id = `${v.producto}|${k}`;
    if (vistos.has(id)) { avisos.vinculos_repetidos++; continue; }
    vistos.add(id);
    vinculos.push({ producto: Number(v.producto), key: k });
  }
  return { ingredientes: [...porNombre.values()], vinculos, avisos };
}

// Escribe dentro de la transacción abierta en `client`. Devuelve los conteos.
export async function importIngredientes(client, prep, actor) {
  const unidad = (await client.query(`SELECT idunidad_medida id FROM unidad_medida
    ORDER BY (upper(codigo)='UN') DESC, (lower(nombre) LIKE 'unidad%') DESC, idunidad_medida LIMIT 1`)).rows[0];
  if (!unidad) throw new Error('No hay unidades de medida para crear los ingredientes');

  const existentes = new Map((await client.query('SELECT idingrediente id, nombre FROM ingrediente')).rows.map(r => [key(r.nombre), r.id]));
  let creados = 0;
  for (const ing of prep.ingredientes) {
    const k = key(ing.nombre);
    if (existentes.has(k)) continue;
    const r = await client.query(`INSERT INTO ingrediente (creado_por, nombre, fk_idunidad_medida, precio_compra, precio_venta, activo)
      VALUES ($1, $2, $3, 0, $4, true) ON CONFLICT (nombre) DO NOTHING RETURNING idingrediente`, [actor, ing.nombre, unidad.id, ing.precio_venta]);
    if (r.rowCount) { existentes.set(k, r.rows[0].idingrediente); creados++; }
  }

  const productos = new Set((await client.query('SELECT idproducto_menu id FROM producto_menu')).rows.map(r => r.id));
  let vinculados = 0, yaExistian = 0, sinProducto = 0;
  for (const v of prep.vinculos) {
    if (!productos.has(v.producto)) { sinProducto++; continue; }
    const r = await client.query(`INSERT INTO producto_menu_ingrediente (fk_idproducto_menu, fk_idingrediente, cantidad, creado_por)
      VALUES ($1, $2, 1, $3) ON CONFLICT (fk_idproducto_menu, fk_idingrediente) DO NOTHING`, [v.producto, existentes.get(v.key), actor]);
    if (r.rowCount) vinculados++; else yaExistian++;
  }
  return {
    ingredientes_creados: creados,
    ingredientes_reutilizados: prep.ingredientes.length - creados,
    vinculos_creados: vinculados,
    vinculos_ya_existian: yaExistian,
    vinculos_sin_producto: sinProducto,
    productos_con_ingredientes: new Set(prep.vinculos.filter(v => productos.has(v.producto)).map(v => v.producto)).size
  };
}
