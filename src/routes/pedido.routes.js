import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, account, order, saveOrder, addAdvance, finishOrder, collect, cancellationPreview, cancelOrder, integer, id, fail } from '../services/pedidos.js';
import { renderPedidoTicket, renderPedidoTicketPage } from '../services/pedido-ticket.js';

const router=Router();
router.use(requireAuth,requireCurrentForm);
const formAccess=requireCurrentForm;
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.code==='P0001'||e.code==='23514'||e.code==='23503') e.status=400; next(e);}};
router.get('/catalogo',route(async req=>{
  const category=req.query.categoria ? id(req.query.categoria, 0):null;
  const unit=req.query.unidad ? id(req.query.unidad):null;
  const page=integer(req.query.page||1,'Página',1); const size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const where='p.activo AND p.es_vender AND ($1::integer IS NULL OR p.fk_idcategoria_menu=$1) AND ($2::integer IS NULL OR p.fk_idunidad_menu=$2) AND p.nombre ILIKE $3';
  const params=[category,unit,`%${String(req.query.search||'').trim()}%`];
  const [categories,allProducts,units,products,count]=await Promise.all([
    pool.query(`SELECT c.idcategoria_menu,c.nombre,c.imagen_url,count(p.idproducto_menu)::int AS cantidad_productos
      FROM categoria_menu c
      LEFT JOIN producto_menu p ON p.fk_idcategoria_menu=c.idcategoria_menu AND p.activo AND p.es_vender
      WHERE c.activa
      GROUP BY c.idcategoria_menu,c.nombre,c.imagen_url,c.orden
      ORDER BY c.orden,c.nombre,c.idcategoria_menu`),
    pool.query('SELECT count(*)::int AS total FROM producto_menu WHERE activo AND es_vender'),
    pool.query('SELECT u.idunidad_menu,u.nombre FROM unidad_menu u WHERE u.activo AND EXISTS(SELECT 1 FROM producto_menu p WHERE p.fk_idunidad_menu=u.idunidad_menu AND p.activo AND p.es_vender AND ($1::integer IS NULL OR p.fk_idcategoria_menu=$1)) ORDER BY u.orden,u.nombre,u.idunidad_menu',[category]),
    pool.query(`SELECT p.idproducto_menu,p.nombre,c.nombre || ' - ' || p.nombre AS nombre_mostrado,p.precio_venta,p.stock_actual,u.nombre AS unidad FROM producto_menu p JOIN unidad_menu u ON u.idunidad_menu=p.fk_idunidad_menu JOIN categoria_menu c ON c.idcategoria_menu=p.fk_idcategoria_menu WHERE ${where} ORDER BY p.orden,p.nombre,p.idproducto_menu LIMIT $4 OFFSET $5`,[...params,size,(page-1)*size]),
    pool.query(`SELECT count(*)::int AS total FROM producto_menu p WHERE ${where}`,params)
  ]);
  return {categorias:categories.rows,totalProductos:allProducts.rows[0].total,unidades:units.rows,items:products.rows,total:count.rows[0].total,totalPages:Math.max(1,Math.ceil(count.rows[0].total/size))};
}));
router.get('/clientes',route(async req=>{
  const search=`%${String(req.query.search||'').trim()}%`;
  const params=[search,req.query.id?id(req.query.id):null,req.query.ocacional==='true'];
  return {items:(await pool.query(`SELECT c.*,z.nombre AS zona_nombre,z.precio_delivery,z.activo AS zona_activa FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente=c.fk_idzona_cliente WHERE c.activo AND ($2::integer IS NULL OR c.idcliente=$2) AND (NOT $3::boolean OR c.es_ocacional) AND (c.nombre_completo ILIKE $1 OR c.ruc ILIKE $1 OR c.telefono ILIKE $1) ORDER BY c.nombre_completo,c.idcliente LIMIT 50`,params)).rows};
}));
router.get('/entregadores',route(async()=>({items:(await pool.query('SELECT identregador_delivery,nombre_completo FROM entregador_delivery WHERE activo ORDER BY nombre_completo,identregador_delivery')).rows})));
router.get('/productos/:id/ingredientes',route(async req=>{
  const productId=id(req.params.id,0);
  const product=(await pool.query('SELECT 1 FROM producto_menu WHERE idproducto_menu=$1',[productId])).rows[0];
  if(!product)fail('Producto no encontrado',404);
  return {items:(await pool.query(`SELECT pi.fk_idingrediente AS idingrediente,pi.cantidad,i.nombre,i.precio_venta,u.codigo AS unidad_codigo
    FROM producto_menu_ingrediente pi JOIN ingrediente i ON i.idingrediente=pi.fk_idingrediente
    JOIN unidad_medida u ON u.idunidad_medida=i.fk_idunidad_medida
    WHERE pi.fk_idproducto_menu=$1 AND i.activo ORDER BY i.nombre,i.idingrediente`,[productId])).rows};
}));
router.get('/formas-pago',route(async()=>({items:(await pool.query('SELECT * FROM forma_pago WHERE activo AND es_ingreso ORDER BY orden,nombre,idforma_pago')).rows})));
router.get('/cuentas/:id',route(req=>account(pool,req.params.id)));
router.post('/cuentas/:id/cobrar',formAccess,route(req=>operation(req,c=>collect(c,req.params.id,req.body,req.user))));
router.get('/caja',formAccess,route(async()=>({caja:(await pool.query("SELECT * FROM caja_gral WHERE estado='abierta'")).rows[0]||null,formas:(await pool.query('SELECT * FROM forma_pago WHERE activo ORDER BY orden,nombre')).rows})));
router.post('/caja/abrir',formAccess,route(req=>operation(req,async c=>{
  const balances=req.body.saldos||{};
  if (typeof balances!=='object'||Array.isArray(balances)) fail('Saldos inválidos');
  for (const [key,value] of Object.entries(balances)){id(key);integer(value,'Saldo inicial');}
  return {idcaja_gral:(await c.query('SELECT abrir_caja_gral($1::jsonb,$2) AS id',[JSON.stringify(balances),req.user.login])).rows[0].id};
})));
router.get('/',route(async req=>{
  const size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const page=integer(req.query.page||1,'Página',1);
  const values=[`%${String(req.query.search||'').trim()}%`,req.query.estado||null];
  const where="(p.idpedido::text ILIKE $1 OR c.nombre_completo ILIKE $1 OR m.numero::text ILIKE $1) AND ($2::text IS NULL OR p.estado::text=$2)";
  const from='FROM pedido p LEFT JOIN cliente c ON c.idcliente=p.fk_idcliente LEFT JOIN mesa m ON m.idmesa=p.fk_idmesa LEFT JOIN entregador_delivery e ON e.identregador_delivery=p.fk_identregador_delivery';
  const total=(await pool.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`,values)).rows[0].total;
  return {items:(await pool.query(`SELECT p.*,c.nombre_completo,m.numero,e.nombre_completo AS entregador_nombre ${from} WHERE ${where} ORDER BY p.idpedido DESC LIMIT $3 OFFSET $4`,[...values,size,(page-1)*size])).rows,total,totalPages:Math.max(1,Math.ceil(total/size))};
}));
router.post('/',route(req=>operation(req,c=>saveOrder(c,req.body,req.user))));
router.get('/:id/ticket.pdf',async(req,res,next)=>{
  try {
    const pedido = await order(pool,req.params.id);
    const pdf = await renderPedidoTicket(pedido);
    res.set({
      'Content-Type':'application/pdf',
      'Content-Disposition':`inline; filename="pedido-${pedido.idpedido}.pdf"`,
      'Cache-Control':'no-store',
      'Content-Length':String(pdf.length)
    });
    res.send(pdf);
  } catch(e) { next(e); }
});
router.get('/:id/ticket',async(req,res,next)=>{
  try {
    const pedido = await order(pool,req.params.id);
    res.type('html').set('Cache-Control','no-store').send(renderPedidoTicketPage(pedido));
  } catch(e) { next(e); }
});
router.get('/:id/anulacion',formAccess,route(req=>cancellationPreview(pool,req.params.id)));
router.get('/:id',route(req=>order(pool,req.params.id)));
router.put('/:id',route(req=>operation(req,c=>saveOrder(c,req.body,req.user,req.params.id))));
router.post('/:id/pago-anticipado',route(req=>operation(req,c=>addAdvance(c,req.params.id,req.body,req.user))));
router.post('/:id/terminar',route(req=>operation(req,c=>finishOrder(c,req.params.id,id(req.body.version_web),req.user))));
router.post('/:id/anular',formAccess,route(req=>operation(req,c=>cancelOrder(c,req.params.id,req.body,req.user))));
export default router;
