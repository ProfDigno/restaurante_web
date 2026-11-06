import { Router } from 'express';
import { pool } from '../config/database.js';
import { kpiGastos, kpiGastosOpciones, validRange } from '../services/kpi-gastos.js';
import { renderKpiGastosPdf } from '../services/kpi-gastos-pdf.js';
import { renderKpiGastosXlsx } from '../services/kpi-gastos-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router=Router();
// Lee el período y el filtro opcional por tipo de gasto (?tipo=id). Devuelve null si son inválidos.
const params=req=>{
  const {inicio,fin}=req.query,tipo=String(req.query.tipo||'');
  if(!validRange(inicio,fin)||(tipo&&!/^[1-9][0-9]{0,8}$/.test(tipo)))return null;
  return {inicio,fin,tipo:tipo?Number(tipo):null};
};
const invalid=res=>res.status(400).json({error:'Ingresá un rango de fechas válido'});
const fileName=(p,ext)=>`analisis-gastos-${p.inicio}_${p.fin}${p.tipo?`-tipo${p.tipo}`:''}.${ext}`;

router.get('/opciones',async(req,res,next)=>{try{res.json(await kpiGastosOpciones());}catch(error){next(error);}});

router.get('/',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const {gastos,semana,...data}=await kpiGastos(p.inicio,p.fin,{tipo:p.tipo});
    res.json(data);
  }catch(error){next(error);}
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const data=await kpiGastos(p.inicio,p.fin,{detalle:true,tipo:p.tipo});
    sendPdf(res,await renderKpiGastosPdf(data,await restaurantInfo(pool)),fileName(p,'pdf'));
  }catch(error){next(error);}
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const file=await renderKpiGastosXlsx(await kpiGastos(p.inicio,p.fin,{detalle:true,tipo:p.tipo}),await restaurantInfo(pool));
    res.set({
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="${fileName(p,'xlsx')}"`,
      'Cache-Control':'no-store',
      'Content-Length':String(file.length)
    });
    res.send(file);
  }catch(error){next(error);}
});
export default router;
