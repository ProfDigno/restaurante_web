import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';
import { renderValeTicket } from '../services/vale-ticket.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';
import { auditar } from '../services/auditoria.js';

// RR.HH. · Vales: adelantos al personal. Se registran pagados y el trigger trg_vale_caja genera el egreso
// en la caja abierta; al anular un vale pagado se registra la reversión (ingreso compensatorio).
const router=Router();
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(error){if(['P0001','23514','23503'].includes(error.code))error.status=400;next(error);}};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const select=`SELECT v.*,p.nombre_completo AS personal_nombre,p.documento AS personal_documento,cg.nombre AS personal_cargo,
  p.tipo_pago AS personal_tipo_pago,f.nombre AS forma_pago_nombre
  FROM vale v JOIN personal p ON p.idpersonal=v.fk_idpersonal LEFT JOIN cargo_personal cg ON cg.idcargo_personal=p.fk_idcargo_personal
  JOIN forma_pago f ON f.idforma_pago=v.fk_idforma_pago`;

router.get('/opciones',route(async()=>{
  const [personal,formas,caja]=await Promise.all([
    pool.query(`SELECT p.idpersonal,p.nombre_completo,cg.nombre AS cargo,p.limite_monto_vale,p.activo FROM personal p
      LEFT JOIN cargo_personal cg ON cg.idcargo_personal=p.fk_idcargo_personal ORDER BY p.activo DESC,p.nombre_completo`),
    pool.query('SELECT idforma_pago,nombre,es_default FROM forma_pago WHERE activo AND es_egreso ORDER BY orden,nombre'),
    pool.query("SELECT 1 FROM caja_gral WHERE estado='abierta'")
  ]);
  return {personal:personal.rows,formas:formas.rows,caja_abierta:caja.rowCount>0};
}));

router.get('/',route(async req=>{
  const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const {inicio,fin}=req.query,estado=String(req.query.estado||''),personal=req.query.personal?id(req.query.personal):null;
  if((inicio&&!validDate(inicio))||(fin&&!validDate(fin))||(inicio&&fin&&inicio>fin))fail('Rango de fechas inválido');
  if(estado&&!['pagado','anulado','pendiente'].includes(estado))fail('Estado inválido');
  const params=[inicio||null,fin||null,personal,estado,`%${String(req.query.search||'').trim()}%`];
  const where=`WHERE ($1::date IS NULL OR v.fecha_vale >= $1::date) AND ($2::date IS NULL OR v.fecha_vale < $2::date + INTERVAL '1 day')
    AND ($3::int IS NULL OR v.fk_idpersonal=$3) AND ($4='' OR v.estado::text=$4)
    AND (v.descripcion ILIKE $5 OR p.nombre_completo ILIKE $5)`;
  const from='FROM vale v JOIN personal p ON p.idpersonal=v.fk_idpersonal';
  const totals=(await pool.query(`SELECT count(*)::int AS total,
    count(*) FILTER (WHERE v.estado='pagado')::int AS pagados,COALESCE(sum(v.monto_vale) FILTER (WHERE v.estado='pagado'),0) AS monto_pagado,
    count(*) FILTER (WHERE v.estado='anulado')::int AS anulados,COALESCE(sum(v.monto_vale) FILTER (WHERE v.estado='anulado'),0) AS monto_anulado
    ${from} ${where}`,params)).rows[0];
  const items=(await pool.query(`${select} ${where} ORDER BY v.fecha_vale DESC,v.idvale DESC LIMIT $6 OFFSET $7`,[...params,size,(page-1)*size])).rows;
  return {items,total:totals.total,resumen:{pagados:totals.pagados,monto_pagado:Number(totals.monto_pagado),anulados:totals.anulados,monto_anulado:Number(totals.monto_anulado)},
    page,pageSize:size,totalPages:Math.max(1,Math.ceil(totals.total/size))};
}));

router.post('/',route(req=>operation(req,async c=>{
  const personalId=id(req.body?.fk_idpersonal),formaId=id(req.body?.fk_idforma_pago);
  const monto=integer(req.body?.monto_vale,'Monto',1);
  const persona=(await c.query('SELECT nombre_completo,activo,limite_monto_vale FROM personal WHERE idpersonal=$1',[personalId])).rows[0];
  if(!persona||!persona.activo)fail('Seleccioná una persona activa');
  if(Number(persona.limite_monto_vale)>0&&monto>Number(persona.limite_monto_vale))fail(`El vale supera el límite de ${new Intl.NumberFormat('es-PY').format(persona.limite_monto_vale)} para ${persona.nombre_completo}`);
  const descripcion=String(req.body?.descripcion||'').trim()||`Vale a ${persona.nombre_completo}`;
  if(descripcion.length>500)fail('El concepto admite hasta 500 caracteres');
  if(!(await c.query('SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND activo AND es_egreso',[formaId])).rowCount)fail('Seleccioná una forma de pago activa para egresos');
  if(!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount)fail('Abrí una caja antes de registrar el vale');
  const created=(await c.query(`INSERT INTO vale(fk_idpersonal,fk_idforma_pago,descripcion,estado,monto_vale,creado_por)
    VALUES($1,$2,$3,'pagado',$4,$5) RETURNING idvale`,[personalId,formaId,descripcion,monto,req.user.login])).rows[0];
  return {item:(await c.query(`${select} WHERE v.idvale=$1`,[created.idvale])).rows[0]};
})));

router.post('/:id/anular',route(req=>operation(req,async c=>{
  const valeId=id(req.params.id),motivo=textRequired(req.body?.motivo,'El motivo');
  if(motivo.length>500)fail('El motivo admite hasta 500 caracteres');
  const vale=(await c.query('SELECT estado,monto_vale FROM vale WHERE idvale=$1 FOR UPDATE',[valeId])).rows[0];
  if(!vale)fail('Vale no encontrado',404);
  if(vale.estado==='anulado')fail('El vale ya fue anulado',409);
  if(vale.estado==='pagado'&&!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount)fail('Abrí una caja antes de anular el vale');
  await c.query('SELECT anular_vale($1,$2,$3)',[valeId,req.user.login,motivo]);
  const item=(await c.query(`${select} WHERE v.idvale=$1`,[valeId])).rows[0];
  await auditar(c,req.user,{accion:'VALE_ANULADO',entidad:'vale',id:valeId,motivo,
    antes:{estado:vale.estado,monto:Number(vale.monto_vale),personal:item.personal_nombre},despues:{estado:item.estado}});
  return {item};
})));

router.get('/:id/ticket.pdf',async(req,res,next)=>{
  try{
    const valeId=id(req.params.id);
    const vale=(await pool.query(`${select} WHERE v.idvale=$1`,[valeId])).rows[0];
    if(!vale)return res.status(404).json({error:'Vale no encontrado'});
    sendPdf(res,await renderValeTicket({vale,restaurante:await restaurantInfo(pool)}),`vale-${valeId}.pdf`);
  }catch(error){next(error);}
});
export default router;
