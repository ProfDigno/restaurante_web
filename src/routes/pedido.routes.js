import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, account, order, saveOrder, addAdvance, finishOrder, collect, cancellationPreview, cancelOrder, integer, id, fail } from '../services/pedidos.js';
import { renderPedidoTicket, renderPedidoTicketPage } from '../services/pedido-ticket.js';
import { leerConfigImpresora } from '../services/impresora-config.js';
import { llevaComanda, paginaComanda, renderComandaTicket } from '../services/comanda-ticket.js';
import { restaurantInfo, sendPdf, ticketRoute } from '../services/ticket-pdf.js';

const router=Router();
router.use(requireAuth,requireCurrentForm);
const formAccess=requireCurrentForm;
// Anular pedidos requiere el permiso de rol "Pedidos: anular" además del acceso a Pedidos.
const cancelAccess=(req,res,next)=>req.user.permisos.includes('FORM_PEDIDOS_ANULAR')?next():res.status(403).json({error:'No tenés permiso para anular pedidos'});
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
    pool.query(`SELECT p.idproducto_menu,p.nombre,c.nombre || ' - ' || p.nombre AS nombre_mostrado,p.precio_venta,p.stock_actual,p.es_cocina,u.nombre AS unidad FROM producto_menu p JOIN unidad_menu u ON u.idunidad_menu=p.fk_idunidad_menu JOIN categoria_menu c ON c.idcategoria_menu=p.fk_idcategoria_menu WHERE ${where} ORDER BY p.orden,p.nombre,p.idproducto_menu LIMIT $4 OFFSET $5`,[...params,size,(page-1)*size]),
    pool.query(`SELECT count(*)::int AS total FROM producto_menu p WHERE ${where}`,params)
  ]);
  return {categorias:categories.rows,totalProductos:allProducts.rows[0].total,unidades:units.rows,items:products.rows,total:count.rows[0].total,totalPages:Math.max(1,Math.ceil(count.rows[0].total/size))};
}));
router.get('/clientes',route(async req=>{
  const search=`%${String(req.query.search||'').trim()}%`;
  const params=[search,req.query.id?id(req.query.id):null,req.query.ocacional==='true'];
  return {items:(await pool.query(`SELECT c.*,z.nombre AS zona_nombre,z.precio_delivery,z.activo AS zona_activa FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente=c.fk_idzona_cliente WHERE c.activo AND ($2::integer IS NULL OR c.idcliente=$2) AND (NOT $3::boolean OR c.es_ocacional) AND (c.nombre_completo ILIKE $1 OR c.ruc ILIKE $1 OR c.telefono ILIKE $1) ORDER BY c.nombre_completo,c.idcliente LIMIT 50`,params)).rows};
}));
const quickClientSelect='SELECT c.*,z.nombre AS zona_nombre,z.precio_delivery,z.activo AS zona_activa FROM cliente c LEFT JOIN zona_cliente z ON z.idzona_cliente=c.fk_idzona_cliente WHERE c.idcliente=$1';
// Nombre escrito en el buscador sin elegir un cliente: usa el cliente activo con ese nombre exacto
// (sin distinguir mayúsculas ni espacios de más) o, si no hay ninguno, lo crea.
router.post('/clientes/por-nombre',route(async req=>{
  const name=String(req.body?.nombre??'').trim().replace(/\s+/g,' ').toUpperCase();
  if(!name)fail('El nombre es obligatorio');
  if(name.length>120)fail('El nombre no puede superar 120 caracteres');
  const found=(await pool.query("SELECT idcliente FROM cliente WHERE activo AND NOT es_ocacional AND upper(regexp_replace(btrim(nombre_completo),'\\s+',' ','g'))=$1 ORDER BY idcliente DESC LIMIT 1",[name])).rows[0];
  if(found)return {item:(await pool.query(quickClientSelect,[found.idcliente])).rows[0],reutilizado:true};
  const created=(await pool.query('INSERT INTO cliente(nombre_completo,razon_social,creado_por) VALUES($1,$1,$2) RETURNING idcliente',[name,req.user.login])).rows[0];
  return {item:(await pool.query(quickClientSelect,[created.idcliente])).rows[0],reutilizado:false};
}));
router.post('/clientes/rapido',route(async req=>{
  const text=(value,max,label)=>{const v=String(value??'').trim();if(v.length>max)fail(`${label} no puede superar ${max} caracteres`);return v||null;};
  const name=text(req.body?.nombre,120,'El nombre')?.toUpperCase()??null;
  const ruc=text(req.body?.ruc,11,'El RUC');
  const phone=text(req.body?.telefono,11,'El teléfono');
  const address=text(req.body?.direccion,250,'La dirección')?.toUpperCase()??null;
  const zoneId=req.body?.fk_idzona_cliente===''||req.body?.fk_idzona_cliente==null?null:Number(req.body.fk_idzona_cliente);
  const delivery=req.body?.tipo_entrega==='DELIVERY';
  if(!name)fail('El nombre es obligatorio');
  if(ruc&&!/^[0-9-]+$/.test(ruc))fail('El RUC solo admite números y guion');
  if(zoneId!==null&&!Number.isInteger(zoneId))fail('La zona seleccionada no es válida');
  if(delivery){
    if(!phone)fail('El teléfono es obligatorio para delivery');
    if(!address)fail('La dirección es obligatoria para delivery');
    if(zoneId===null)fail('La zona es obligatoria para delivery');
  }
  if(zoneId!==null&&!(await pool.query('SELECT 1 FROM zona_cliente WHERE idzona_cliente=$1 AND activo',[zoneId])).rows.length)fail('La zona seleccionada no existe o está inactiva');
  const found=(await pool.query('SELECT idcliente,activo,direccion,fk_idzona_cliente,ruc,telefono FROM cliente WHERE ($1::text IS NOT NULL AND lower(btrim(ruc))=lower($1)) OR ($2::text IS NOT NULL AND btrim(telefono)=$2)',[ruc,phone])).rows;
  if(new Set(found.map(c=>c.idcliente)).size>1)fail('El RUC y el teléfono pertenecen a clientes distintos',409);
  try{
    if(found.length){
      const current=found[0];
      if(!current.activo)fail('El cliente existe pero está inactivo',409);
      await pool.query('UPDATE cliente SET direccion=COALESCE(direccion,$2),fk_idzona_cliente=COALESCE(fk_idzona_cliente,$3),ruc=COALESCE(ruc,$4),telefono=COALESCE(telefono,$5) WHERE idcliente=$1',[current.idcliente,address,zoneId,ruc,phone]);
      return {item:(await pool.query(quickClientSelect,[current.idcliente])).rows[0],reutilizado:true};
    }
    const created=(await pool.query('INSERT INTO cliente(nombre_completo,razon_social,ruc,direccion,telefono,fk_idzona_cliente,creado_por) VALUES($1,$1,$2,$3,$4,$5,$6) RETURNING idcliente',[name,ruc,address,phone,zoneId,req.user.login])).rows[0];
    return {item:(await pool.query(quickClientSelect,[created.idcliente])).rows[0],reutilizado:false};
  }catch(e){if(e.code==='23505')fail('Ya existe un cliente con ese RUC o teléfono',409);throw e;}
}));
router.put('/clientes/:id/zona',route(async req=>{
  const clientId=id(req.params.id);
  const zoneId=Number(req.body?.fk_idzona_cliente);
  if(!Number.isInteger(zoneId)||zoneId<=0)fail('Seleccioná una zona válida');
  if(!(await pool.query('SELECT 1 FROM zona_cliente WHERE idzona_cliente=$1 AND activo',[zoneId])).rows.length)fail('La zona seleccionada no existe o está inactiva');
  const updated=await pool.query('UPDATE cliente SET fk_idzona_cliente=$2 WHERE idcliente=$1 AND activo RETURNING idcliente',[clientId,zoneId]);
  if(!updated.rows.length)fail('Cliente no encontrado o inactivo',404);
  return {item:(await pool.query(quickClientSelect,[clientId])).rows[0]};
}));
// Delivery: completa la dirección y/o el teléfono que le faltan al cliente (no pisa datos que ya tiene).
router.put('/clientes/:id/contacto',route(async req=>{
  const clientId=id(req.params.id);
  const address=String(req.body?.direccion??'').trim().replace(/\s+/g,' ').toUpperCase()||null;
  const phone=String(req.body?.telefono??'').trim()||null;
  if(address&&address.length>250)fail('La dirección no puede superar 250 caracteres');
  if(phone&&(phone.length>40||!/^[0-9+\s-]+$/.test(phone)))fail('El teléfono solo admite números');
  if(!address&&!phone)fail('Ingresá la dirección o el teléfono');
  try{
    const updated=await pool.query('UPDATE cliente SET direccion=COALESCE(direccion,$2),telefono=COALESCE(telefono,$3) WHERE idcliente=$1 AND activo AND NOT es_ocacional RETURNING idcliente',[clientId,address,phone]);
    if(!updated.rows.length)fail('Cliente no encontrado, inactivo u ocasional',404);
  }catch(e){if(e.code==='23505')fail('Ya existe otro cliente con ese teléfono',409);throw e;}
  return {item:(await pool.query(quickClientSelect,[clientId])).rows[0]};
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
  // Rol con el permiso "Pedidos: ver solo los propios": el usuario ve únicamente los pedidos que creó.
  const soloPropios=req.user.permisos.includes('FORM_PEDIDOS_SOLO_PROPIOS');
  // Rango opcional por fecha de creación del pedido (YYYY-MM-DD, ambos extremos incluidos).
  const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;
  const desde=req.query.desde||null,hasta=req.query.hasta||null;
  if((desde&&!validDate(desde))||(hasta&&!validDate(hasta))||(desde&&hasta&&desde>hasta))fail('Rango de fechas inválido');
  const values=[`%${String(req.query.search||'').trim()}%`,req.query.estado||null,soloPropios?req.user.login:null,desde,hasta];
  const where="(p.idpedido::text ILIKE $1 OR c.nombre_completo ILIKE $1 OR m.numero::text ILIKE $1) AND ($2::text IS NULL OR p.estado::text=$2) AND ($3::text IS NULL OR p.creado_por=$3) AND ($4::date IS NULL OR p.fecha_creado>=$4::date) AND ($5::date IS NULL OR p.fecha_creado<$5::date+INTERVAL '1 day')";
  const from='FROM pedido p LEFT JOIN cliente c ON c.idcliente=p.fk_idcliente LEFT JOIN mesa m ON m.idmesa=p.fk_idmesa LEFT JOIN entregador_delivery e ON e.identregador_delivery=p.fk_identregador_delivery LEFT JOIN usuario u ON u.login=p.creado_por';
  const total=(await pool.query(`SELECT count(*)::int AS total ${from} WHERE ${where}`,values)).rows[0].total;
  return {items:(await pool.query(`SELECT p.*,c.nombre_completo,m.numero,e.nombre_completo AS entregador_nombre,COALESCE(u.nombre,p.creado_por) AS creado_por_nombre,
    (SELECT string_agg(DISTINCT f.nombre, ' + ') FROM pago pg JOIN forma_pago f ON f.idforma_pago=pg.fk_idforma_pago
      WHERE pg.estado='aprobado' AND (pg.fk_idpedido=p.idpedido OR (pg.fk_idpedido IS NULL AND pg.fk_idcuenta=p.fk_idcuenta))) AS formas_pago ${from} WHERE ${where} ORDER BY p.idpedido DESC LIMIT $6 OFFSET $7`,[...values,size,(page-1)*size])).rows,total,totalPages:Math.max(1,Math.ceil(total/size)),soloPropios};
}));
router.post('/',route(req=>operation(req,c=>saveOrder(c,req.body,req.user))));
// Con ?impresion=1 (botón Imprimir sin agente) agrega la comanda como segunda página si corresponde.
ticketRoute(router,'/:id/ticket.pdf',async(req,res,next)=>{
  try {
    const pedido = await order(pool,req.params.id);
    const config = await leerConfigImpresora();
    const paginas = req.query.impresion === '1' && llevaComanda(pedido, config) ? [await paginaComanda(pedido, config)] : [];
    const pdf = await renderPedidoTicket(pedido, await restaurantInfo(pool), new Date(), config, paginas);
    await sendPdf(res, pdf, `pedido-${pedido.idpedido}.pdf`);
  } catch(e) { next(e); }
});
ticketRoute(router,'/:id/comanda.pdf',async(req,res,next)=>{
  try {
    const pedido = await order(pool,req.params.id);
    await sendPdf(res, await renderComandaTicket(pedido, await leerConfigImpresora()), `comanda-${pedido.idpedido}.pdf`);
  } catch(e) { next(e); }
});
// Qué manda al agente el botón Imprimir: un trabajo por documento, para que la impresora corte entre uno y otro.
router.get('/:id/impresion',route(async req=>{
  const pedido = await order(pool,req.params.id);
  const base = `/api/pedidos/${pedido.idpedido}`;
  const documentos = [{ url: `${base}/ticket.pdf`, nombre: `Pedido #${pedido.idpedido}` }];
  if (llevaComanda(pedido, await leerConfigImpresora())) documentos.push({ url: `${base}/comanda.pdf`, nombre: `Comanda #${pedido.idpedido}` });
  return { documentos };
}));
router.get('/:id/ticket',async(req,res,next)=>{
  try {
    const pedido = await order(pool,req.params.id);
    res.type('html').set('Cache-Control','no-store').send(renderPedidoTicketPage(pedido, await restaurantInfo(pool), await leerConfigImpresora()));
  } catch(e) { next(e); }
});
router.get('/:id/anulacion',formAccess,cancelAccess,route(req=>cancellationPreview(pool,req.params.id)));
router.get('/:id',route(req=>order(pool,req.params.id)));
router.put('/:id',route(req=>operation(req,c=>saveOrder(c,req.body,req.user,req.params.id))));
router.post('/:id/pago-anticipado',route(req=>operation(req,c=>addAdvance(c,req.params.id,req.body,req.user))));
router.post('/:id/terminar',route(req=>operation(req,c=>finishOrder(c,req.params.id,id(req.body.version_web),req.user))));
router.post('/:id/anular',formAccess,cancelAccess,route(req=>operation(req,c=>cancelOrder(c,req.params.id,req.body,req.user))));
export default router;
