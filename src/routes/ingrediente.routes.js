import { Router } from 'express'; import { pool } from '../config/database.js'; import { requireAuth, requireCurrentForm } from '../middleware/auth.js'; import { auditar, cambios, numeros } from '../services/auditoria.js';
const router=Router();router.use(requireAuth);const size=v=>[25,50,100].includes(Number(v))?Number(v):25;const valid=b=>{const v={nombre:String(b?.nombre||'').trim(),fk_idunidad_medida:Number(b?.fk_idunidad_medida),stock_actual:Number(b?.stock_actual??0),stock_minimo:Number(b?.stock_minimo??0),precio_compra:Number(b?.precio_compra??0),precio_venta:Number(b?.precio_venta??0),activo:b?.activo!==false};if(!v.nombre)return'El nombre es obligatorio';if(!Number.isInteger(v.fk_idunidad_medida))return'La unidad de medida es obligatoria';if(![v.stock_actual,v.stock_minimo,v.precio_compra,v.precio_venta].every(n=>Number.isInteger(n)&&n>=0))return'Stock y precios deben ser enteros no negativos';return v};const select=`SELECT i.idingrediente,i.fecha_creado,i.creado_por,i.nombre,i.fk_idunidad_medida,i.stock_actual,i.stock_minimo,i.precio_compra,i.precio_venta,i.activo,u.codigo unidad_codigo,u.nombre unidad_nombre FROM ingrediente i JOIN unidad_medida u ON u.idunidad_medida=i.fk_idunidad_medida`;
router.get('/',async(req,res,next)=>{try{const q=String(req.query.search||'').trim(),p=Math.max(1,Number(req.query.page)||1),s=size(req.query.pageSize),pat=`%${q}%`,o=(p-1)*s,w=`WHERE i.nombre ILIKE $1 OR u.nombre ILIKE $1 OR u.codigo ILIKE $1`;const[l,c]=await Promise.all([pool.query(`${select} ${w} ORDER BY i.nombre,i.idingrediente LIMIT $2 OFFSET $3`,[pat,s,o]),pool.query(`SELECT count(*)::int total FROM ingrediente i JOIN unidad_medida u ON u.idunidad_medida=i.fk_idunidad_medida ${w}`,[pat])]);const total=c.rows[0].total;res.json({items:l.rows,total,page:p,pageSize:s,totalPages:Math.max(1,Math.ceil(total/s))})}catch(e){next(e)}});
router.post('/',requireCurrentForm,async(req,res,next)=>{try{const v=valid(req.body);if(typeof v==='string')return res.status(400).json({error:v});const{rows}=await pool.query(`INSERT INTO ingrediente(nombre,fk_idunidad_medida,stock_actual,stock_minimo,precio_compra,precio_venta,activo,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING idingrediente`,[v.nombre,v.fk_idunidad_medida,v.stock_actual,v.stock_minimo,v.precio_compra,v.precio_venta,v.activo,req.user.login]);const r=await pool.query(`${select} WHERE i.idingrediente=$1`,[rows[0].idingrediente]);res.status(201).json({item:r.rows[0]})}catch(e){if(e.code==='23503')return res.status(400).json({error:'La unidad de medida no existe'});if(e.code==='23505')return res.status(409).json({error:'Ya existe ese ingrediente'});next(e)}});
// Precio y stock cambiados a mano quedan en la auditoría, en la misma transacción que el cambio.
router.put('/:id',requireCurrentForm,async(req,res,next)=>{
  const v=valid(req.body);if(typeof v==='string')return res.status(400).json({error:v});
  const ingredienteId=Number(req.params.id);
  if(!Number.isSafeInteger(ingredienteId)||ingredienteId<1||ingredienteId>2147483647)return res.status(404).json({error:'Ingrediente no encontrado'});
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const before=(await client.query('SELECT nombre,stock_actual,precio_compra,precio_venta FROM ingrediente WHERE idingrediente=$1 FOR UPDATE',[ingredienteId])).rows[0];
    if(!before){await client.query('ROLLBACK');return res.status(404).json({error:'Ingrediente no encontrado'});}
    await client.query(`UPDATE ingrediente SET nombre=$1,fk_idunidad_medida=$2,stock_actual=$3,stock_minimo=$4,precio_compra=$5,precio_venta=$6,activo=$7 WHERE idingrediente=$8`,[v.nombre,v.fk_idunidad_medida,v.stock_actual,v.stock_minimo,v.precio_compra,v.precio_venta,v.activo,ingredienteId]);
    const diff=cambios(before,v,['precio_compra','precio_venta','stock_actual']);
    if(diff)await auditar(client,req.user,{accion:'INGREDIENTE_MODIFICADO',entidad:'ingrediente',id:ingredienteId,antes:{ingrediente:before.nombre,...numeros(diff.antes)},despues:numeros(diff.despues)});
    await client.query('COMMIT');
    const r=await pool.query(`${select} WHERE i.idingrediente=$1`,[ingredienteId]);res.json({item:r.rows[0]});
  }catch(e){await client.query('ROLLBACK');if(e.code==='23503')return res.status(400).json({error:'La unidad de medida no existe'});if(e.code==='23505')return res.status(409).json({error:'Ya existe ese ingrediente'});next(e);}
  finally{client.release();}
});
export default router;
