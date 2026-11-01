import { Router } from 'express';
import { pool } from '../config/database.js';

const router=Router();
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`))&&new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)===value;
const numeric=(rows,fields)=>rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,fields.includes(key)?Number(value||0):value])));

router.get('/',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validDate(inicio)||!validDate(fin)||inicio>fin)return res.status(400).json({error:'Ingresá un rango de fechas válido'});
  try{
    const dates=[inicio,fin];
    const range="g.fecha_gasto >= $1::date AND g.fecha_gasto < ($2::date + INTERVAL '1 day')";
    const [summary,daily,types,forms,top]=await Promise.all([
      pool.query(`SELECT
        count(*) FILTER (WHERE ${range} AND g.estado='pagado')::int AS cantidad,
        COALESCE(sum(g.total_gasto) FILTER (WHERE ${range} AND g.estado='pagado'),0) AS monto,
        count(*) FILTER (WHERE ${range} AND g.estado='anulado')::int AS anulados_cantidad,
        COALESCE(sum(g.total_gasto) FILTER (WHERE ${range} AND g.estado='anulado'),0) AS anulados_monto,
        count(*) FILTER (WHERE g.fecha_gasto >= ($1::date - (($2::date - $1::date) + 1)) AND g.fecha_gasto < $1::date AND g.estado='pagado')::int AS anterior_cantidad,
        COALESCE(sum(g.total_gasto) FILTER (WHERE g.fecha_gasto >= ($1::date - (($2::date - $1::date) + 1)) AND g.fecha_gasto < $1::date AND g.estado='pagado'),0) AS anterior_monto
        FROM gasto g`,dates),
      pool.query(`SELECT to_char(d.dia,'YYYY-MM-DD') AS fecha,count(g.idgasto)::int AS cantidad,
        COALESCE(sum(g.total_gasto),0) AS monto
        FROM generate_series($1::date,$2::date,INTERVAL '1 day') AS d(dia)
        LEFT JOIN gasto g ON g.fecha_gasto >= d.dia AND g.fecha_gasto < d.dia + INTERVAL '1 day' AND g.estado='pagado'
        GROUP BY d.dia ORDER BY d.dia`,dates),
      pool.query(`SELECT t.idgasto_tipo AS id,t.nombre,count(*)::int AS cantidad,sum(g.total_gasto) AS monto
        FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo
        WHERE ${range} AND g.estado='pagado' GROUP BY t.idgasto_tipo,t.nombre ORDER BY monto DESC`,dates),
      pool.query(`SELECT f.idforma_pago AS id,f.nombre,count(*)::int AS cantidad,sum(g.total_gasto) AS monto
        FROM gasto g JOIN forma_pago f ON f.idforma_pago=g.fk_idforma_pago
        WHERE ${range} AND g.estado='pagado' GROUP BY f.idforma_pago,f.nombre ORDER BY monto DESC`,dates),
      pool.query(`SELECT g.idgasto,to_char(g.fecha_gasto,'YYYY-MM-DD') AS fecha,t.nombre AS tipo,
        g.descripcion,g.total_gasto AS monto FROM gasto g JOIN gasto_tipo t ON t.idgasto_tipo=g.fk_idgasto_tipo
        WHERE ${range} AND g.estado='pagado' ORDER BY g.total_gasto DESC,g.idgasto DESC LIMIT 5`,dates)
    ]);
    const s=summary.rows[0];
    res.json({inicio,fin,resumen:{cantidad:s.cantidad,monto:Number(s.monto),promedio:s.cantidad?Number(s.monto)/s.cantidad:0,
      anulados:{cantidad:s.anulados_cantidad,monto:Number(s.anulados_monto)},anterior:{cantidad:s.anterior_cantidad,monto:Number(s.anterior_monto)}},
      dias:numeric(daily.rows,['monto']),tipos:numeric(types.rows,['monto']),formas:numeric(forms.rows,['monto']),mayores:numeric(top.rows,['monto'])});
  }catch(error){next(error);}
});
export default router;
