import { Router } from 'express';
import { pool } from '../config/database.js';
import { kpiGastos, validRange } from '../services/kpi-gastos.js';
import { renderKpiGastosPdf } from '../services/kpi-gastos-pdf.js';
import { renderKpiGastosXlsx } from '../services/kpi-gastos-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router=Router();
const invalid=res=>res.status(400).json({error:'Ingresá un rango de fechas válido'});

router.get('/',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const {gastos,semana,...data}=await kpiGastos(inicio,fin);
    res.json(data);
  }catch(error){next(error);}
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const data=await kpiGastos(inicio,fin,{detalle:true});
    sendPdf(res,await renderKpiGastosPdf(data,await restaurantInfo(pool)),`analisis-gastos-${inicio}_${fin}.pdf`);
  }catch(error){next(error);}
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx',async(req,res,next)=>{
  const {inicio,fin}=req.query;
  if(!validRange(inicio,fin))return invalid(res);
  try{
    const data=await kpiGastos(inicio,fin,{detalle:true});
    const file=await renderKpiGastosXlsx(data,await restaurantInfo(pool));
    res.set({
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':`attachment; filename="analisis-gastos-${inicio}_${fin}.xlsx"`,
      'Cache-Control':'no-store',
      'Content-Length':String(file.length)
    });
    res.send(file);
  }catch(error){next(error);}
});
export default router;
