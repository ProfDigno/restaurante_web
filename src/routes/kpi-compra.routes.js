import { Router } from 'express';
import { pool } from '../config/database.js';
import { validRange } from '../services/kpi-gastos.js';
import { kpiCompras } from '../services/kpi-compras.js';
import { renderKpiComprasPdf } from '../services/kpi-compras-pdf.js';
import { renderKpiComprasXlsx } from '../services/kpi-compras-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router=Router();
const invalid=res=>res.status(400).json({error:'Ingresá un rango de fechas válido'});

router.get('/',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const {compras,...data}=await kpiCompras(inicio,fin);
    res.json(data);
  }catch(error){next(error);}
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const data=await kpiCompras(inicio,fin,{detalle:true});
    sendPdf(res,await renderKpiComprasPdf(data,await restaurantInfo(pool)),`analisis-compras-${inicio}_${fin}.pdf`);
  }catch(error){next(error);}
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const file=await renderKpiComprasXlsx(await kpiCompras(inicio,fin,{detalle:true}),await restaurantInfo(pool));
    res.set({
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="analisis-compras-${inicio}_${fin}.xlsx"`,
      'Cache-Control':'no-store',
      'Content-Length':String(file.length)
    });
    res.send(file);
  }catch(error){next(error);}
});
export default router;
