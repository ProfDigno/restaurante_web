import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';
import { renderCompraTicket } from '../services/compra-ticket.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router=Router();
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(error){if(['P0001','23514','23503','23505'].includes(error.code))error.status=error.code==='23505'?409:400;next(error);}};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const select=`SELECT c.*,p.nombre AS proveedor_nombre,p.ruc AS proveedor_ruc,p.telefono AS proveedor_telefono,u.nombre AS usuario_nombre FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor JOIN usuario u ON u.idusuario=c.fk_idusuario`;
async function full(c,compraId){
  const compra=(await c.query(`${select} WHERE c.idcompra=$1`,[id(compraId)])).rows[0];
  if(!compra)fail('Compra no encontrada',404);
  compra.detalles=(await c.query(`SELECT d.*,cm.nombre || ' · ' || um.nombre || ' · ' || pm.nombre AS nombre,
    cm.nombre AS categoria,um.nombre AS unidad,pm.nombre AS producto,
    pm.stock_actual,d.cantidad*d.precio_compra AS subtotal FROM detalle_compra_producto d
    JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
    JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
    JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
    WHERE d.fk_idcompra=$1 ORDER BY d.iddetalle_compra_producto`,[compraId])).rows;
  compra.pagos=(await c.query(`SELECT cp.*,f.nombre AS forma_pago_nombre FROM compra_pago cp JOIN forma_pago f ON f.idforma_pago=cp.fk_idforma_pago WHERE cp.fk_idcompra=$1 ORDER BY cp.idcompra_pago`,[compraId])).rows;
  compra.saldo=Number(compra.total)-Number(compra.importe_pagado);
  compra.total_borrador=compra.detalles.reduce((sum,item)=>sum+Number(item.subtotal),0);
  return compra;
}
router.get('/opciones',route(async()=>{
  const formas=(await pool.query('SELECT idforma_pago,nombre,es_default FROM forma_pago WHERE activo AND es_egreso ORDER BY orden,nombre')).rows;
  return {formas};
}));
router.get('/proveedores',route(async req=>({items:(await pool.query(`SELECT idproveedor,nombre,ruc,telefono FROM proveedor WHERE activo AND
  (nombre ILIKE $1 OR COALESCE(ruc,'') ILIKE $1 OR COALESCE(telefono,'') ILIKE $1)
  ORDER BY nombre,idproveedor LIMIT 30`,[`%${String(req.query.search||'').trim()}%`])).rows})));
router.get('/productos',route(async req=>({items:(await pool.query(`SELECT pm.idproducto_menu,cm.nombre || ' · ' || um.nombre || ' · ' || pm.nombre AS nombre,
  cm.nombre AS categoria,um.nombre AS unidad,pm.nombre AS producto,
  pm.precio_compra,pm.stock_actual FROM producto_menu pm
  JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
  JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
  WHERE pm.activo AND pm.es_comprar AND (pm.nombre ILIKE $1 OR cm.nombre ILIKE $1 OR um.nombre ILIKE $1)
  ORDER BY cm.nombre,um.nombre,pm.nombre,pm.idproducto_menu LIMIT 40`,[`%${String(req.query.search||'').trim()}%`])).rows})));
router.get('/',route(async req=>{
  const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const search=`%${String(req.query.search||'').trim()}%`,estado=String(req.query.estado||''),{inicio,fin}=req.query;
  if(estado&&!['borrador','recibida','cancelada'].includes(estado))fail('Estado inválido');
  if((inicio&&!validDate(inicio))||(fin&&!validDate(fin))||(inicio&&fin&&inicio>fin))fail('Rango de fechas inválido');
  const where="WHERE ($1::text='' OR c.estado::text=$1) AND (p.nombre ILIKE $2 OR COALESCE(c.numero_nota,'') ILIKE $2) AND ($3::date IS NULL OR c.fecha_compra >= $3::date) AND ($4::date IS NULL OR c.fecha_compra < $4::date + INTERVAL '1 day')";
  const total=(await pool.query(`SELECT count(*)::int AS total FROM compra c JOIN proveedor p ON p.idproveedor=c.fk_idproveedor ${where}`,[estado,search,inicio||null,fin||null])).rows[0].total;
  const items=(await pool.query(`${select} ${where} ORDER BY c.idcompra DESC LIMIT $5 OFFSET $6`,[estado,search,inicio||null,fin||null,size,(page-1)*size])).rows;
  return {items,total,page,pageSize:size,totalPages:Math.max(1,Math.ceil(total/size))};
}));
router.get('/:id',route(req=>full(pool,req.params.id)));
router.get('/:id/ticket.pdf',async(req,res,next)=>{
  try{
    const compra=await full(pool,req.params.id);
    sendPdf(res,await renderCompraTicket({compra,restaurante:await restaurantInfo(pool)}),`compra-${compra.idcompra}.pdf`);
  }catch(error){next(error);}
});
async function saveDraft(c,req,editing){
  const body=req.body||{},proveedorId=id(body.fk_idproveedor);
  if(body.confirmar!==true&&(![undefined,null,'',0,'0'].includes(body.anticipo)||body.fk_idforma_pago))fail('Para registrar un pago inicial, confirmá la compra; el borrador no registra pagos');
  if(!(await c.query('SELECT 1 FROM proveedor WHERE idproveedor=$1 AND activo',[proveedorId])).rowCount)fail('Seleccioná un proveedor activo');
  if(!validDate(body.fecha_compra))fail('Ingresá una fecha de compra válida');
  const condicion=String(body.condicion||'').toUpperCase();
  if(!['CONTADO','CREDITO'].includes(condicion))fail('Seleccioná contado o crédito');
  const nota=String(body.numero_nota||'').trim(),observacion=String(body.observacion||'').trim();
  if(nota.length>80)fail('El número de nota admite hasta 80 caracteres');
  if(observacion.length>2000)fail('La observación es demasiado larga');
  if(!Array.isArray(body.detalles)||!body.detalles.length||body.detalles.length>200)fail('Agregá entre 1 y 200 productos');
  const seen=new Set(),lines=[];
  for(const line of body.detalles){
    const productId=id(line.fk_idproducto_menu,0),quantity=integer(line.cantidad,'Cantidad',1),price=integer(line.precio_compra,'Precio de compra');
    if(seen.has(productId))fail('No repitas productos en la compra');
    seen.add(productId);lines.push({productId,quantity,price});
  }
  const products=(await c.query('SELECT idproducto_menu FROM producto_menu WHERE idproducto_menu=ANY($1::int[]) AND activo AND es_comprar',[lines.map(x=>x.productId)])).rows;
  if(products.length!==lines.length)fail('Uno o más productos no están habilitados para compra');
  let compraId;
  if(editing){
    compraId=id(req.params.id);
    const row=(await c.query('SELECT estado FROM compra WHERE idcompra=$1 FOR UPDATE',[compraId])).rows[0];
    if(!row)fail('Compra no encontrada',404);
    if(row.estado!=='borrador')fail('Solo se puede editar una compra en borrador',409);
    await c.query('DELETE FROM detalle_compra_producto WHERE fk_idcompra=$1',[compraId]);
    await c.query('UPDATE compra SET fk_idproveedor=$1,fecha_compra=$2::date,condicion=$3,numero_nota=$4,observacion=$5 WHERE idcompra=$6',[proveedorId,body.fecha_compra,condicion,nota||null,observacion||null,compraId]);
  }else{
    compraId=(await c.query(`INSERT INTO compra(fk_idproveedor,fk_idusuario,fecha_compra,condicion,numero_nota,observacion,creado_por)
      VALUES($1,$2,$3::date,$4,$5,$6,$7) RETURNING idcompra`,[proveedorId,req.user.sub,body.fecha_compra,condicion,nota||null,observacion||null,req.user.login])).rows[0].idcompra;
  }
  for(const line of lines)await c.query('INSERT INTO detalle_compra_producto(fk_idcompra,fk_idproducto_menu,cantidad,precio_compra,creado_por) VALUES($1,$2,$3,$4,$5)',[compraId,line.productId,line.quantity,line.price,req.user.login]);
  if(body.confirmar===true)return {compra:await receivePurchase(c,req,compraId)};
  return {compra:await full(c,compraId)};
}
router.post('/',route(req=>operation(req,c=>saveDraft(c,req,false))));
router.put('/:id',route(req=>operation(req,c=>saveDraft(c,req,true))));
async function receivePurchase(c,req,compraId){
  const compra=(await c.query('SELECT estado,condicion FROM compra WHERE idcompra=$1 FOR UPDATE',[compraId])).rows[0];
  if(!compra)fail('Compra no encontrada',404);
  if(compra.estado!=='borrador')fail('La compra ya fue recibida o cancelada',409);
  const anticipo=integer(req.body?.anticipo??0,'Anticipo');
  await c.query('SELECT registrar_compra_recibida($1,$2)',[compraId,req.user.login]);
  const received=(await c.query('SELECT total,condicion FROM compra WHERE idcompra=$1',[compraId])).rows[0];
  const amount=received.condicion==='CONTADO'?Number(received.total):anticipo;
  if(received.condicion==='CONTADO'&&anticipo)fail('En contado el pago es total y automático');
  if(amount>Number(received.total))fail('El anticipo supera el total de la compra');
  if(amount){
    const payForm=id(req.body?.fk_idforma_pago);
    await c.query('INSERT INTO compra_pago(fk_idcompra,fk_idforma_pago,importe,creado_por) VALUES($1,$2,$3,$4)',[compraId,payForm,amount,req.user.login]);
  }
  return full(c,compraId);
}
router.post('/:id/recibir',route(req=>operation(req,async c=>({compra:await receivePurchase(c,req,id(req.params.id))}))));
router.post('/:id/pagos',route(req=>operation(req,async c=>{
  const compraId=id(req.params.id),formId=id(req.body?.fk_idforma_pago),amount=integer(req.body?.importe,'Importe',1);
  await c.query('INSERT INTO compra_pago(fk_idcompra,fk_idforma_pago,importe,creado_por) VALUES($1,$2,$3,$4)',[compraId,formId,amount,req.user.login]);
  return {compra:await full(c,compraId)};
})));
router.post('/:id/anular',route(req=>operation(req,async c=>{
  const compraId=id(req.params.id),motivo=textRequired(req.body?.motivo,'El motivo');
  if(motivo.length>1000)fail('El motivo admite hasta 1000 caracteres');
  const current=(await c.query('SELECT estado,estado_pago FROM compra WHERE idcompra=$1 FOR UPDATE',[compraId])).rows[0];
  if(!current)fail('Compra no encontrada',404);
  if(current.estado==='cancelada')fail('La compra ya está cancelada',409);
  if(!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount)fail('Abrí una caja antes de anular la compra');
  await c.query('SELECT anular_compra($1,$2,$3)',[compraId,req.user.login,motivo]);
  if(current.estado_pago==='pendiente')await c.query("UPDATE compra SET estado_pago='anulada' WHERE idcompra=$1",[compraId]);
  await c.query("UPDATE compra_pago SET estado='anulado',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$2 WHERE fk_idcompra=$1 AND estado='aprobado'",[compraId,req.user.login]);
  return {compra:await full(c,compraId)};
})));
export default router;
