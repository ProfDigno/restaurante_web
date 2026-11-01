import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { mkdir, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth, requireCurrentForm);
const pageSizeValue = (value) => [25, 50, 100].includes(Number(value)) ? Number(value) : 25;
const maxImageSize = 5 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../uploads/categorias');
await mkdir(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, callback) => {
    const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
    callback(null, `${randomUUID()}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: maxImageSize, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!allowedTypes.has(file.mimetype)) return callback(Object.assign(new Error('Solo se permiten imágenes JPEG, PNG o WebP'), { code: 'INVALID_IMAGE_TYPE' }));
    callback(null, true);
  }
});
const uploadImage = (req, res, next) => upload.single('image')(req, res, (error) => {
  if (!error) return next();
  if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'La imagen no puede superar los 5 MB' });
  if (error.code === 'INVALID_IMAGE_TYPE') return res.status(400).json({ error: error.message });
  return next(error);
});

const isTrue = (value) => value === true || value === 'true' || value === '1' || value === 1;
const imageUrl = (file) => file ? `/uploads/categorias/${file.filename}` : null;
const diskPath = (url) => url?.startsWith('/uploads/categorias/') ? path.join(uploadsDir, path.basename(url)) : null;
const removeFile = async (url) => { const filePath = diskPath(url); if (filePath) await unlink(filePath).catch(() => {}); };
const validImageSignature = (buffer, mime) => {
  if (mime === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8;
  if (mime === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
};
const validateUploadedImage = async (file) => {
  if (!file) return;
  const header = await readFile(file.path);
  if (!validImageSignature(header, file.mimetype)) {
    await removeFile(imageUrl(file));
    const error = new Error('El archivo no contiene una imagen válida');
    error.status = 400;
    throw error;
  }
};
const selectFields = 'idcategoria_menu, fecha_creado, creado_por, nombre, descripcion, imagen_url, orden, activa';
const activeValue = (value) => value !== 'false' && value !== false;

router.get('/', async (req, res, next) => {
  try {
    const search = String(req.query.search || '').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = pageSizeValue(req.query.pageSize);
    const pattern = `%${search}%`;
    const offset = (page - 1) * pageSize;
    const [list, count] = await Promise.all([
      pool.query(`SELECT ${selectFields} FROM categoria_menu WHERE nombre ILIKE $1 OR COALESCE(descripcion, '') ILIKE $1 ORDER BY orden, nombre, idcategoria_menu LIMIT $2 OFFSET $3`, [pattern, pageSize, offset]),
      pool.query(`SELECT count(*)::int AS total FROM categoria_menu WHERE nombre ILIKE $1 OR COALESCE(descripcion, '') ILIKE $1`, [pattern])
    ]);
    const total = count.rows[0].total;
    res.json({ items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.get('/:id/productos', async (req, res, next) => {
  try {
    const rawId = String(req.params.id);
    if (!/^\d+$/.test(rawId) || !Number.isSafeInteger(Number(rawId)) || Number(rawId) > 2147483647) {
      return res.status(400).json({ error: 'Categoría inválida' });
    }
    const categoryId = Number(rawId);
    const category = (await pool.query('SELECT idcategoria_menu, nombre FROM categoria_menu WHERE idcategoria_menu=$1', [categoryId])).rows[0];
    if (!category) return res.status(404).json({ error: 'Categoría no encontrada' });
    const requestedPage = Number(req.query.page);
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const pageSize = pageSizeValue(req.query.pageSize);
    const [list, count] = await Promise.all([
      pool.query(`SELECT p.idproducto_menu,p.nombre,p.precio_venta,p.stock_actual,p.activo,
        g.nombre AS grupo_nombre,u.nombre AS unidad_nombre
        FROM producto_menu p JOIN grupo_menu g ON g.idgrupo_menu=p.fk_idgrupo_menu
        JOIN unidad_menu u ON u.idunidad_menu=p.fk_idunidad_menu
        WHERE p.fk_idcategoria_menu=$1 ORDER BY p.orden,p.nombre,p.idproducto_menu LIMIT $2 OFFSET $3`, [categoryId,pageSize,(page-1)*pageSize]),
      pool.query('SELECT count(*)::int AS total FROM producto_menu WHERE fk_idcategoria_menu=$1', [categoryId])
    ]);
    const total = count.rows[0].total;
    res.json({ category, items: list.rows, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) { next(error); }
});

router.post('/', uploadImage, async (req, res, next) => {
  const file = req.file;
  try {
    await validateUploadedImage(file);
    const nombre = String(req.body?.nombre || '').trim();
    const descripcion = String(req.body?.descripcion || '').trim() || null;
    if (!nombre) { if (file) await removeFile(imageUrl(file)); return res.status(400).json({ error: 'El nombre es obligatorio' }); }
    const { rows } = await pool.query(`INSERT INTO categoria_menu (nombre, descripcion, imagen_url, orden, activa, creado_por) SELECT $1, $2, $3, (COALESCE(MAX(orden), 0) + 1)::smallint, $4, $5 FROM categoria_menu RETURNING ${selectFields}`, [nombre, descripcion, imageUrl(file), activeValue(req.body?.activa), req.user.login]);
    res.status(201).json({ item: rows[0] });
  } catch (error) {
    if (file) await removeFile(imageUrl(file));
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    next(error);
  }
});

router.post('/:id/orden', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id); const direction = req.body?.direction;
    if (!Number.isInteger(id) || !['up', 'down'].includes(direction)) return res.status(400).json({ error: 'Movimiento de orden inválido' });
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT idcategoria_menu, orden FROM categoria_menu ORDER BY orden, nombre, idcategoria_menu FOR UPDATE');
    const index = rows.findIndex((item) => item.idcategoria_menu === id);
    if (index < 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Categoría no encontrada' }); }
    const neighborIndex = direction === 'up' ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= rows.length) { await client.query('COMMIT'); return res.json({ moved: false }); }
    const current = rows[index]; const neighbor = rows[neighborIndex];
    await client.query('UPDATE categoria_menu SET orden = CASE idcategoria_menu WHEN $1::integer THEN $2::smallint WHEN $3::integer THEN $4::smallint END WHERE idcategoria_menu IN ($1::integer, $3::integer)', [current.idcategoria_menu, neighbor.orden, neighbor.idcategoria_menu, current.orden]);
    await client.query('COMMIT'); res.json({ moved: true });
  } catch (error) { await client.query('ROLLBACK'); next(error); } finally { client.release(); }
});

router.put('/:id', uploadImage, async (req, res, next) => {
  const file = req.file;
  try {
    await validateUploadedImage(file);
    const id = Number(req.params.id);
    const nombre = String(req.body?.nombre || '').trim();
    const descripcion = String(req.body?.descripcion || '').trim() || null;
    if (!nombre) { if (file) await removeFile(imageUrl(file)); return res.status(400).json({ error: 'El nombre es obligatorio' }); }
    const existing = await pool.query('SELECT imagen_url FROM categoria_menu WHERE idcategoria_menu = $1', [id]);
    if (!existing.rows.length) { if (file) await removeFile(imageUrl(file)); return res.status(404).json({ error: 'Categoría no encontrada' }); }
    const oldImage = existing.rows[0].imagen_url;
    const nextImage = file ? imageUrl(file) : isTrue(req.body?.removeImage) ? null : oldImage;
    const { rows } = await pool.query(`UPDATE categoria_menu SET nombre = $1, descripcion = $2, imagen_url = $3, activa = $4 WHERE idcategoria_menu = $5 RETURNING ${selectFields}`, [nombre, descripcion, nextImage, activeValue(req.body?.activa), id]);
    if (oldImage && oldImage !== nextImage) await removeFile(oldImage);
    res.json({ item: rows[0] });
  } catch (error) {
    if (file) await removeFile(imageUrl(file));
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe una categoría con ese nombre' });
    next(error);
  }
});

export default router;
