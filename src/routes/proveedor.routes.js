import { Router } from 'express';
import { pool } from '../config/database.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';

const router=Router();
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(error){if(error.code==='23505'){error.status=409;error.message='Ya existe un proveedor con ese nombre o RUC';}next(error);}};
router.get('/',route(async req=>{
  const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25;
  const search=`%${String(req.query.search||'').trim()}%`;
  const where='WHERE nombre ILIKE $1 OR COALESCE(ruc,\'\') ILIKE $1 OR COALESCE(telefono,\'\') ILIKE $1';
  const total=(await pool.query(`SELECT count(*)::int AS total FROM proveedor ${where}`,[search])).rows[0].total;
  const items=(await pool.query(`SELECT * FROM proveedor ${where} ORDER BY nombre,idproveedor LIMIT $2 OFFSET $3`,[search,size,(page-1)*size])).rows;
  return {items,total,page,pageSize:size,totalPages:Math.max(1,Math.ceil(total/size))};
}));
async function save(c,req,editing){
  const body=req.body||{},nombre=textRequired(body.nombre,'El nombre');
  if(nombre.length>140)fail('El nombre admite hasta 140 caracteres');
  if(typeof body.activo!=='boolean')fail('El estado debe ser booleano');
  const fields=[['ruc',30],['direccion',250],['telefono',40],['contacto',120],['email',255]];
  const values=fields.map(([key,max])=>{const value=String(body[key]||'').trim();if(value.length>max)fail(`${key} admite hasta ${max} caracteres`);return value||null;});
  if(editing){const result=await c.query(`UPDATE proveedor SET nombre=$1,ruc=$2,direccion=$3,telefono=$4,contacto=$5,email=$6,activo=$7 WHERE idproveedor=$8 RETURNING *`,[nombre,...values,body.activo,id(req.params.id)]);if(!result.rowCount)fail('Proveedor no encontrado',404);return {item:result.rows[0]};}
  return {item:(await c.query(`INSERT INTO proveedor(nombre,ruc,direccion,telefono,contacto,email,activo,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[nombre,...values,body.activo,req.user.login])).rows[0]};
}
router.post('/',route(req=>operation(req,c=>save(c,req,false))));
router.put('/:id',route(req=>operation(req,c=>save(c,req,true))));
export default router;
