import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

// RR.HH. · Personal: datos básicos, forma de pago (día, semana, quincena o mes) y límite de vales.
const router=Router();
export const TIPOS_PAGO=['DIARIO','SEMANAL','QUINCENAL','MENSUAL'];
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(error){
  if(error.code==='23505'){error.status=409;error.message='Ya existe una persona con ese documento';}
  else if(['P0001','23514'].includes(error.code))error.status=400;
  next(error);}};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const select=`SELECT p.*,to_char(p.fecha_ingreso,'YYYY-MM-DD') AS fecha_ingreso,
  (SELECT COALESCE(sum(v.monto_vale),0) FROM vale v WHERE v.fk_idpersonal=p.idpersonal AND v.estado='pagado'
    AND v.fecha_vale >= date_trunc('month',CURRENT_DATE)) AS vales_mes
  FROM personal p`;

router.get('/',route(async req=>{
  const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const search=`%${String(req.query.search||'').trim()}%`,estado=String(req.query.estado||'');
  if(estado&&!['activo','inactivo'].includes(estado))fail('Estado inválido');
  const where=`WHERE (p.nombre_completo ILIKE $1 OR COALESCE(p.documento,'') ILIKE $1 OR COALESCE(p.cargo,'') ILIKE $1 OR COALESCE(p.telefono,'') ILIKE $1)
    AND ($2='' OR p.activo=($2='activo'))`;
  const total=(await pool.query(`SELECT count(*)::int AS total FROM personal p ${where}`,[search,estado])).rows[0].total;
  const items=(await pool.query(`${select} ${where} ORDER BY p.activo DESC,p.nombre_completo,p.idpersonal LIMIT $3 OFFSET $4`,[search,estado,size,(page-1)*size])).rows;
  return {items,total,page,pageSize:size,totalPages:Math.max(1,Math.ceil(total/size))};
}));

async function save(c,req,editing){
  const body=req.body||{},nombre=textRequired(body.nombre_completo,'El nombre');
  if(nombre.length>120)fail('El nombre admite hasta 120 caracteres');
  if(typeof body.activo!=='boolean')fail('El estado debe ser booleano');
  const tipo=String(body.tipo_pago||'').toUpperCase();
  if(!TIPOS_PAGO.includes(tipo))fail('Elegí la forma de pago: diario, semanal, quincenal o mensual');
  const monto=integer(body.monto_pago??0,'Sueldo'),limite=integer(body.limite_monto_vale??0,'Límite de vale');
  const fecha=String(body.fecha_ingreso||'').trim();
  if(fecha&&!validDate(fecha))fail('Ingresá una fecha de ingreso válida');
  const fields=[['documento',40,'El documento'],['telefono',40,'El teléfono'],['cargo',80,'El cargo'],['direccion',250,'La dirección'],['observacion',500,'La observación']];
  const values=fields.map(([key,max,label])=>{const value=String(body[key]||'').trim();if(value.length>max)fail(`${label} admite hasta ${max} caracteres`);return value||null;});
  const params=[nombre,...values,fecha||null,tipo,monto,limite,body.activo];
  if(editing){
    const result=await c.query(`UPDATE personal SET nombre_completo=$1,documento=$2,telefono=$3,cargo=$4,direccion=$5,observacion=$6,
      fecha_ingreso=$7::date,tipo_pago=$8,monto_pago=$9,limite_monto_vale=$10,activo=$11 WHERE idpersonal=$12 RETURNING idpersonal`,[...params,id(req.params.id)]);
    if(!result.rowCount)fail('Persona no encontrada',404);
    return {item:(await c.query(`${select} WHERE p.idpersonal=$1`,[result.rows[0].idpersonal])).rows[0]};
  }
  const created=(await c.query(`INSERT INTO personal(nombre_completo,documento,telefono,cargo,direccion,observacion,fecha_ingreso,tipo_pago,monto_pago,limite_monto_vale,activo,creado_por)
    VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12) RETURNING idpersonal`,[...params,req.user.login])).rows[0];
  return {item:(await c.query(`${select} WHERE p.idpersonal=$1`,[created.idpersonal])).rows[0]};
}
router.post('/',route(req=>operation(req,c=>save(c,req,false))));
router.put('/:id',route(req=>operation(req,c=>save(c,req,true))));
export default router;
