import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requireCurrentForm } from '../middleware/auth.js';
import { operation, integer, id, fail, textRequired } from '../services/pedidos.js';
const router=Router();
router.use(requireAuth,requireCurrentForm);
const route=fn=>async(req,res,next)=>{try{res.json(await fn(req));}catch(e){if(e.code==='23505'){e.message='Ya existe una forma de pago con ese nombre';e.status=409;}next(e);}};
router.get('/',route(async req=>{
 const page=integer(req.query.page||1,'Página',1),size=[25,50,100].includes(Number(req.query.pageSize))?Number(req.query.pageSize):25,search=`%${String(req.query.search||'').trim()}%`;
 const total=(await pool.query('SELECT count(*)::int AS total FROM forma_pago WHERE nombre ILIKE $1',[search])).rows[0].total;
 return {items:(await pool.query('SELECT * FROM forma_pago WHERE nombre ILIKE $1 ORDER BY orden,nombre,idforma_pago LIMIT $2 OFFSET $3',[search,size,(page-1)*size])).rows,total,totalPages:Math.max(1,Math.ceil(total/size))};
}));
async function save(c,req,editing){
 const name=textRequired(req.body.nombre,'El nombre'); if(name.length>80) fail('El nombre admite hasta 80 caracteres');
 for(const key of ['activo','es_ingreso','es_egreso']) if(typeof req.body[key]!=='boolean') fail('Estado y banderas deben ser booleanos');
 if(req.body.es_default!==undefined&&typeof req.body.es_default!=='boolean') fail('Estado y banderas deben ser booleanos');
 await c.query('LOCK TABLE forma_pago IN SHARE ROW EXCLUSIVE MODE');
 const current=editing?(await c.query('SELECT es_default FROM forma_pago WHERE idforma_pago=$1',[id(req.params.id)])).rows[0]:null;
 if(editing&&!current)fail('Forma de pago no encontrada',404);
 // Sin dato explícito se conserva el valor actual (alta: no es la forma por defecto).
 const isDefault=req.body.es_default??(current?.es_default||false);
 if(isDefault&&!req.body.activo)fail('La forma de pago por defecto debe estar activa. Marcá otra como por defecto antes de desactivar esta.');
 if(isDefault&&!req.body.es_ingreso)fail('La forma de pago por defecto debe permitir ingresos');
 if(!isDefault&&current?.es_default)fail('Debe existir una forma de pago por defecto. Marcá otra como por defecto para reemplazar a esta.');
 const params=[name,req.body.activo,req.body.es_ingreso,req.body.es_egreso,isDefault];
 // Una sola por defecto: al elegir una nueva se desmarca la anterior.
 if(isDefault)await c.query('UPDATE forma_pago SET es_default=false WHERE es_default'+(editing?' AND idforma_pago<>$1':''),editing?[id(req.params.id)]:[]);
 if(editing){const r=await c.query('UPDATE forma_pago SET nombre=$1,activo=$2,es_ingreso=$3,es_egreso=$4,es_default=$5 WHERE idforma_pago=$6 RETURNING *',[...params,id(req.params.id)]);return {item:r.rows[0]};}
 const next=(await c.query('SELECT COALESCE(MAX(orden),0)+1 AS orden FROM forma_pago')).rows[0].orden;
 if(next>32767)fail('Se alcanzó el máximo de orden');
 return {item:(await c.query('INSERT INTO forma_pago(nombre,activo,es_ingreso,es_egreso,es_default,orden,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[...params,next,req.user.login])).rows[0]};
}
router.post('/',route(req=>operation(req,c=>save(c,req,false))));
router.put('/:id',route(req=>operation(req,c=>save(c,req,true))));
router.post('/:id/orden',route(req=>operation(req,async c=>{
 if(!['up','down'].includes(req.body.direction))fail('Dirección inválida');
 await c.query('LOCK TABLE forma_pago IN SHARE ROW EXCLUSIVE MODE');
 const rows=(await c.query('SELECT idforma_pago FROM forma_pago ORDER BY orden,nombre,idforma_pago FOR UPDATE')).rows;
 const i=rows.findIndex(r=>r.idforma_pago===id(req.params.id));if(i<0)fail('Forma de pago no encontrada',404);
 const j=i+(req.body.direction==='up'?-1:1);if(j<0||j>=rows.length)return {moved:false};
 [rows[i],rows[j]]=[rows[j],rows[i]];
 if(rows.length>32767)fail('Demasiadas formas de pago para reordenar');
 for(let k=0;k<rows.length;k++)await c.query('UPDATE forma_pago SET orden=$1::smallint WHERE idforma_pago=$2::integer',[k+1,rows[k].idforma_pago]);
 return {moved:true};
})));
export default router;
