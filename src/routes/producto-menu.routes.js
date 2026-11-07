import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { auditar, cambios, numeros } from '../services/auditoria.js';

const router = Router();
router.use(requireAuth, requireCurrentForm);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const integerValue = (value, min = 1) => value !== '' && value !== undefined && value !== null && Number.isInteger(Number(value)) && Number(value) >= min ? Number(value) : null;
const amountValue = (value, fallback = 0) => value === undefined || value === null || value === '' ? fallback : Number(value);
const booleanValue = (value, fallback = false) => value === undefined ? fallback : value !== false;
const selectIngredients = `SELECT pi.fk_idingrediente AS idingrediente, pi.cantidad,
  i.nombre, i.activo, i.precio_venta, i.fk_idunidad_medida, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre
  FROM producto_menu_ingrediente pi
  JOIN ingrediente i ON i.idingrediente = pi.fk_idingrediente
  JOIN unidad_medida u ON u.idunidad_medida = i.fk_idunidad_medida
  WHERE pi.fk_idproducto_menu = $1 ORDER BY i.nombre, i.idingrediente`;

const validateIngredients = (items) => {
  if (!Array.isArray(items)) return 'La lista de ingredientes debe ser un arreglo';
  const seen = new Set();
  const values = [];
  for (const item of items) {
    const id = integerValue(item?.idingrediente);
    const quantity = String(item?.cantidad ?? '').trim();
    if (id === null) return 'Seleccioná un ingrediente válido';
    if (seen.has(id)) return 'No se puede repetir un ingrediente';
    if (!/^[1-9]\d{0,13}$/.test(quantity) || !Number.isSafeInteger(Number(quantity))) return 'La cantidad debe ser un número entero mayor a cero';
    seen.add(id);
    values.push({ idingrediente: id, cantidad: quantity });
  }
  return values;
};

const selectProduct = `
  SELECT p.idproducto_menu, p.fecha_creado, p.creado_por, p.fk_idcategoria_menu,
    p.fk_idunidad_menu, p.fk_idgrupo_menu, p.nombre, p.descripcion,
    p.precio_venta, p.precio_compra, p.orden, p.stock_actual, p.stock_minimo,
    p.activo, p.es_descontar_stock, p.es_cocina, p.es_vender, p.es_comprar,
    (SELECT count(*)::int FROM producto_menu_ingrediente pi WHERE pi.fk_idproducto_menu = p.idproducto_menu) AS ingredientes_count,
    c.nombre AS categoria_nombre, u.nombre AS unidad_nombre, g.nombre AS grupo_nombre
  FROM producto_menu p
  JOIN categoria_menu c ON c.idcategoria_menu = p.fk_idcategoria_menu
  JOIN unidad_menu u ON u.idunidad_menu = p.fk_idunidad_menu
  JOIN grupo_menu g ON g.idgrupo_menu = p.fk_idgrupo_menu`;

const validateProduct = (body) => {
  const values = {
    nombre: String(body?.nombre || '').trim(),
    descripcion: String(body?.descripcion || '').trim() || null,
    fk_idcategoria_menu: integerValue(body?.fk_idcategoria_menu, 0),
    fk_idunidad_menu: integerValue(body?.fk_idunidad_menu, 0),
    fk_idgrupo_menu: integerValue(body?.fk_idgrupo_menu, 0),
    precio_venta: amountValue(body?.precio_venta),
    precio_compra: amountValue(body?.precio_compra),
    stock_actual: amountValue(body?.stock_actual),
    stock_minimo: amountValue(body?.stock_minimo),
    activo: booleanValue(body?.activo, true),
    es_descontar_stock: booleanValue(body?.es_descontar_stock),
    es_cocina: booleanValue(body?.es_cocina, true),
    es_vender: booleanValue(body?.es_vender, true),
    es_comprar: booleanValue(body?.es_comprar)
  };
  if (!values.nombre) return 'El nombre es obligatorio';
  if (values.fk_idcategoria_menu === null || values.fk_idunidad_menu === null || values.fk_idgrupo_menu === null) return 'Categoría, grupo y unidad son obligatorios';
  if (![values.precio_venta, values.precio_compra, values.stock_actual, values.stock_minimo].every((value) => Number.isInteger(value) && value >= 0)) return 'Precios y stock deben ser números enteros mayores o iguales a cero';
  return values;
};

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = pageSizeValue(req.query.pageSize);
    const pattern = `%${search}%`;
    const offset = (page - 1) * pageSize;
    const where = `WHERE p.nombre ILIKE $1 OR COALESCE(p.descripcion, '') ILIKE $1 OR c.nombre ILIKE $1 OR g.nombre ILIKE $1 OR u.nombre ILIKE $1`;
    const [list, count] = await Promise.all([
      pool.query(`${selectProduct} ${where} ORDER BY p.orden, p.nombre, p.idproducto_menu LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]),
      pool.query(`SELECT count(*)::int AS total FROM producto_menu p JOIN categoria_menu c ON c.idcategoria_menu = p.fk_idcategoria_menu JOIN unidad_menu u ON u.idunidad_menu = p.fk_idunidad_menu JOIN grupo_menu g ON g.idgrupo_menu = p.fk_idgrupo_menu ${where}`, [pattern])
    ]);
    const total = count.rows[0].total;
    res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = integerValue(req.params.id, 0);
    if (id === null) return res.status(400).json({ error: 'Producto inválido' });
    const { rows } = await pool.query(`${selectProduct} WHERE p.idproducto_menu = $1`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json({ item: rows[0] });
  } catch (error) { next(error); }
});

router.get('/:id/ingredientes', async (req, res, next) => {
  try {
    const id = integerValue(req.params.id, 0);
    if (id === null) return res.status(400).json({ error: 'Producto inválido' });
    const product = await pool.query('SELECT 1 FROM producto_menu WHERE idproducto_menu = $1', [id]);
    if (!product.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    const { rows } = await pool.query(selectIngredients, [id]);
    res.json({ items: rows });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const values = validateProduct(req.body);
    if (typeof values === 'string') return res.status(400).json({ error: values });
    const { rows } = await pool.query(`INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, descripcion, precio_venta, precio_compra, orden, stock_actual, stock_minimo, activo, es_descontar_stock, es_cocina, es_vender, es_comprar, creado_por) SELECT $1, $2, $3, $4, $5, $6, $7, (COALESCE(MAX(orden), 0) + 1)::smallint, $8, $9, $10, $11, $12, $13, $14, $15 FROM producto_menu RETURNING idproducto_menu`, [values.fk_idcategoria_menu, values.fk_idunidad_menu, values.fk_idgrupo_menu, values.nombre, values.descripcion, values.precio_venta, values.precio_compra, values.stock_actual, values.stock_minimo, values.activo, values.es_descontar_stock, values.es_cocina, values.es_vender, values.es_comprar, req.user.login]);
    const created = await pool.query(`${selectProduct} WHERE p.idproducto_menu = $1`, [rows[0].idproducto_menu]);
    res.status(201).json({ item: created.rows[0] });
  } catch (error) { if (error.code === '23503') return res.status(400).json({ error: 'La categoría, grupo o unidad seleccionada no existe' }); next(error); }
});

router.post('/:id/orden', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id); const direction = req.body?.direction;
    if (!Number.isInteger(id) || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Movimiento de orden inválido' });
    await client.query('BEGIN');
    const { rows } = await client.query(`SELECT idproducto_menu, orden FROM producto_menu ORDER BY orden, nombre, idproducto_menu FOR UPDATE`);
    const index = rows.findIndex((item) => item.idproducto_menu === id);
    if (index < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado' }); }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= rows.length) { await client.query('COMMIT'); return res.json({ moved: false }); }
    const current = rows[index]; const neighbor = rows[neighborIndex];
    await client.query(`UPDATE producto_menu SET orden = CASE idproducto_menu WHEN $1::integer THEN $2::smallint WHEN $3::integer THEN $4::smallint END WHERE idproducto_menu IN ($1::integer, $3::integer)`, [current.idproducto_menu, neighbor.orden, neighbor.idproducto_menu, current.orden]);
    await client.query('COMMIT'); res.json({ moved: true });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

router.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const values = validateProduct(req.body);
    if (typeof values === 'string') return res.status(400).json({ error: values });
    const id = integerValue(req.params.id, 0);
    if (id === null) return res.status(400).json({ error: 'Producto inválido' });
    const hasIngredients = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'ingredientes');
    const ingredients = hasIngredients ? validateIngredients(req.body.ingredientes) : null;
    if (typeof ingredients === 'string') return res.status(400).json({ error: ingredients });
    await client.query('BEGIN');
    const before = (await client.query('SELECT nombre, precio_venta, precio_compra, stock_actual FROM producto_menu WHERE idproducto_menu = $1 FOR UPDATE', [id])).rows[0];
    const { rows } = await client.query(`UPDATE producto_menu SET fk_idcategoria_menu = $1, fk_idunidad_menu = $2, fk_idgrupo_menu = $3, nombre = $4, descripcion = $5, precio_venta = $6, precio_compra = $7, stock_actual = $8, stock_minimo = $9, activo = $10, es_descontar_stock = $11, es_cocina = $12, es_vender = $13, es_comprar = $14 WHERE idproducto_menu = $15 RETURNING idproducto_menu`, [values.fk_idcategoria_menu, values.fk_idunidad_menu, values.fk_idgrupo_menu, values.nombre, values.descripcion, values.precio_venta, values.precio_compra, values.stock_actual, values.stock_minimo, values.activo, values.es_descontar_stock, values.es_cocina, values.es_vender, values.es_comprar, id]);
    if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Producto no encontrado' }); }
    // Precio y stock cambiados a mano quedan en la auditoría.
    const diff = cambios(before, values, ['precio_venta', 'precio_compra', 'stock_actual']);
    if (diff) await auditar(client, req.user, { accion: 'PRODUCTO_MODIFICADO', entidad: 'producto', id,
      antes: { producto: before.nombre, ...numeros(diff.antes) }, despues: numeros(diff.despues) });
    if (hasIngredients) {
      for (const ingredient of ingredients) {
        const found = await client.query(`SELECT 1 FROM ingrediente i WHERE i.idingrediente = $1 AND (i.activo OR EXISTS (SELECT 1 FROM producto_menu_ingrediente pi WHERE pi.fk_idproducto_menu = $2 AND pi.fk_idingrediente = i.idingrediente))`, [ingredient.idingrediente, id]);
        if (!found.rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Un ingrediente no existe o está inactivo' }); }
      }
      await client.query('DELETE FROM producto_menu_ingrediente WHERE fk_idproducto_menu = $1 AND NOT (fk_idingrediente = ANY($2::integer[]))', [id, ingredients.map((ingredient) => ingredient.idingrediente)]);
      for (const ingredient of ingredients) {
        await client.query(`INSERT INTO producto_menu_ingrediente (fk_idproducto_menu, fk_idingrediente, cantidad, creado_por)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (fk_idproducto_menu, fk_idingrediente) DO UPDATE SET cantidad = EXCLUDED.cantidad`, [id, ingredient.idingrediente, ingredient.cantidad, req.user.login]);
      }
    }
    const updated = await client.query(`${selectProduct} WHERE p.idproducto_menu = $1`, [id]);
    await client.query('COMMIT');
    res.json({ item: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23503') return res.status(400).json({ error: 'La categoría, grupo, unidad o ingrediente seleccionado no existe' });
    next(error);
  } finally { client.release(); }
});

export default router;
