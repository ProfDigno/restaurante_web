import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

const router = Router();
const route = fn => async (req,res,next) => { try { res.json(await fn(req)); } catch (error) { if (error.code === '23505') { error.status=409; error.message='Ya existe un tipo de gasto con ese nombre'; } next(error); } };
router.get('/',route(async req => {
  const page=integer(req.query.page||1,'Página',1), size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const search=`%${String(req.query.search||'').trim()}%`;
  const total=(await pool.query('SELECT count(*)::int AS total FROM gasto_tipo WHERE nombre ILIKE $1',[search])).rows[0].total;
  const items=(await pool.query('SELECT * FROM gasto_tipo WHERE nombre ILIKE $1 ORDER BY orden,nombre,idgasto_tipo LIMIT $2 OFFSET $3',[search,size,(page-1)*size])).rows;
  return {items,total,page,pageSize:size,totalPages:Math.max(1,Math.ceil(total/size))};
}));
async function save(c,req,editing) {
  const nombre=textRequired(req.body?.nombre,'El nombre');
  if(nombre.length>100) fail('El nombre admite hasta 100 caracteres');
  if(typeof req.body?.activo!=='boolean') fail('El estado debe ser booleano');
  await c.query('LOCK TABLE gasto_tipo IN SHARE ROW EXCLUSIVE MODE');
  if(editing) {
    const result=await c.query('UPDATE gasto_tipo SET nombre=$1,activo=$2 WHERE idgasto_tipo=$3 RETURNING *',[nombre,req.body.activo,id(req.params.id)]);
    if(!result.rowCount) fail('Tipo de gasto no encontrado',404);
    return {item:result.rows[0]};
  }
  const next=(await c.query('SELECT COALESCE(MAX(orden),0)+1 AS orden FROM gasto_tipo')).rows[0].orden;
  if(next>32767) fail('Se alcanzó el máximo de orden');
  return {item:(await c.query('INSERT INTO gasto_tipo(nombre,activo,orden,creado_por) VALUES($1,$2,$3,$4) RETURNING *',[nombre,req.body.activo,next,req.user.login])).rows[0]};
}
router.post('/',route(req=>operation(req,c=>save(c,req,false))));
router.put('/:id',route(req=>operation(req,c=>save(c,req,true))));
router.post('/:id/orden',route(req=>operation(req,async c=>{
  if(!['up','down'].includes(req.body?.direction)) fail('Dirección inválida');
  await c.query('LOCK TABLE gasto_tipo IN SHARE ROW EXCLUSIVE MODE');
  const rows=(await c.query('SELECT idgasto_tipo FROM gasto_tipo ORDER BY orden,nombre,idgasto_tipo FOR UPDATE')).rows;
  const i=rows.findIndex(row=>row.idgasto_tipo===id(req.params.id));
  if(i<0) fail('Tipo de gasto no encontrado',404);
  const j=i+(req.body.direction==='up'?-1:1);
  if(j<0||j>=rows.length) return {moved:false};
  [rows[i],rows[j]]=[rows[j],rows[i]];
  if(rows.length>32767) fail('Demasiados tipos de gasto para reordenar');
  for(let k=0;k<rows.length;k++) await c.query('UPDATE gasto_tipo SET orden=$1::smallint WHERE idgasto_tipo=$2',[k+1,rows[k].idgasto_tipo]);
  return {moved:true};
})));
export default router;
