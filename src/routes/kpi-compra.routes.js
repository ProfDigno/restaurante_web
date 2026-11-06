import { Router } from 'express';
import { pool } from '../config/database.js';
import { validRange } from '../services/kpi-gastos.js';
import { kpiCompras, kpiComprasOpciones } from '../services/kpi-compras.js';
import { renderKpiComprasPdf } from '../services/kpi-compras-pdf.js';
import { renderKpiComprasXlsx } from '../services/kpi-compras-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router=Router();
// Lee el período y el filtro opcional por proveedor (?proveedor=id). Devuelve null si son inválidos.
const params=req=>{
  const {inicio,fin}=req.query,proveedor=String(req.query.proveedor||'');
  if(!validRange(inicio,fin)||(proveedor&&!/^[1-9][0-9]{0,8}$/.test(proveedor)))return null;
  return {inicio,fin,proveedor:proveedor?Number(proveedor):null};
};
const invalid=res=>res.status(400).json({error:'Ingresá un rango de fechas válido'});
const fileName=(p,ext)=>`analisis-compras-${p.inicio}_${p.fin}${p.proveedor?`-proveedor${p.proveedor}`:''}.${ext}`;

router.get('/opciones',async(req,res,next)=>{try{res.json(await kpiComprasOpciones());}catch(error){next(error);}});

router.get('/',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const {compras,...data}=await kpiCompras(p.inicio,p.fin,{proveedor:p.proveedor});
    res.json(data);
  }catch(error){next(error);}
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const data=await kpiCompras(p.inicio,p.fin,{detalle:true,proveedor:p.proveedor});
    sendPdf(res,await renderKpiComprasPdf(data,await restaurantInfo(pool)),fileName(p,'pdf'));
  }catch(error){next(error);}
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx',async(req,res,next)=>{
  const p=params(req);
  if(!p)return invalid(res);
  try{
    const file=await renderKpiComprasXlsx(await kpiCompras(p.inicio,p.fin,{detalle:true,proveedor:p.proveedor}),await restaurantInfo(pool));
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
