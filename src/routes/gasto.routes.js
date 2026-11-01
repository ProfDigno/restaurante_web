import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

const router=Router();
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(error){if(['P0001','23514','23503','23505'].includes(error.code))error.status=error.code==='23505'?409:400;next(error);}};
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const select=`SELECT g.*,t.nombre AS tipo_nombre,f.nombre AS forma_pago_nombre FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo JOIN forma_pago f ON f.idforma_pago=g.fk_idforma_pago`;

router.get('/opciones',route(async()=>{
  const [tipos,formas]=await Promise.all([
    pool.query('SELECT idgasto_tipo,nombre,activo FROM gasto_tipo ORDER BY orden,nombre'),
    pool.query('SELECT idforma_pago,nombre FROM forma_pago WHERE activo AND es_egreso ORDER BY orden,nombre')
  ]);
  return {tipos:tipos.rows,formas:formas.rows};
}));
router.get('/',route(async req=>{
  const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const {inicio,fin,tipo}=req.query;
  if((inicio&&!validDate(inicio))||(fin&&!validDate(fin))||(inicio&&fin&&inicio>fin))fail('Rango de fechas inválido');
  const tipoId=tipo?id(tipo):null;
  const params=[inicio||null,fin||null,tipoId,`%${String(req.query.search||'').trim()}%`];
  const where=`WHERE ($1::date IS NULL OR g.fecha_gasto >= $1::date) AND ($2::date IS NULL OR g.fecha_gasto < $2::date + INTERVAL '1 day') AND ($3::int IS NULL OR g.fk_idgasto_tipo=$3) AND g.descripcion ILIKE $4`;
  const total=(await pool.query(`SELECT count(*)::int AS total FROM gasto g ${where}`,params)).rows[0].total;
  const items=(await pool.query(`${select} ${where} ORDER BY g.fecha_gasto DESC,g.idgasto DESC LIMIT $5 OFFSET $6`,[...params,size,(page-1)*size])).rows;
  return {items,total,page,pageSize:size,totalPages:Math.max(1,Math.ceil(total/size))};
}));
router.post('/',route(req=>operation(req,async c=>{
  const fecha=req.body?.fecha_gasto;
  if(!validDate(fecha))fail('Ingresá una fecha de gasto válida');
  const tipoId=id(req.body?.fk_idgasto_tipo),formaId=id(req.body?.fk_idforma_pago);
  const descripcion=textRequired(req.body?.descripcion,'La descripción');
  if(descripcion.length>500)fail('La descripción admite hasta 500 caracteres');
  const monto=integer(req.body?.total_gasto,'Importe',1);
  if(!(await c.query('SELECT 1 FROM gasto_tipo WHERE idgasto_tipo=$1 AND activo',[tipoId])).rowCount)fail('Seleccioná un tipo de gasto activo');
  if(!(await c.query('SELECT 1 FROM forma_pago WHERE idforma_pago=$1 AND activo AND es_egreso',[formaId])).rowCount)fail('Seleccioná una forma de pago activa para egresos');
  if(!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount)fail('Abrí una caja antes de registrar el gasto');
  const result=await c.query(`INSERT INTO gasto(fk_idgasto_tipo,fk_idforma_pago,fecha_gasto,descripcion,total_gasto,estado,creado_por)
    VALUES($1,$2,$3::date,$4,$5,'pagado',$6) RETURNING idgasto`,[tipoId,formaId,fecha,descripcion,monto,req.user.login]);
  return {item:(await c.query(`${select} WHERE g.idgasto=$1`,[result.rows[0].idgasto])).rows[0]};
})));
router.post('/:id/anular',route(req=>operation(req,async c=>{
  const gastoId=id(req.params.id),motivo=textRequired(req.body?.motivo,'El motivo');
  if(motivo.length>500)fail('El motivo admite hasta 500 caracteres');
  const gasto=(await c.query('SELECT estado FROM gasto WHERE idgasto=$1 FOR UPDATE',[gastoId])).rows[0];
  if(!gasto)fail('Gasto no encontrado',404);
  if(gasto.estado!=='pagado')fail('El gasto ya fue anulado',409);
  if(!(await c.query("SELECT 1 FROM caja_gral WHERE estado='abierta' FOR UPDATE")).rowCount)fail('Abrí una caja antes de anular el gasto');
  await c.query("UPDATE gasto SET estado='anulado',fecha_anulado=CURRENT_TIMESTAMP,anulado_por=$1,motivo_anulado=$2 WHERE idgasto=$3",[req.user.login,motivo,gastoId]);
  return {item:(await c.query(`${select} WHERE g.idgasto=$1`,[gastoId])).rows[0]};
})));
export default router;
