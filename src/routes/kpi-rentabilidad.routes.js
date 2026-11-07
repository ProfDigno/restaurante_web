import { Router } from 'express';
import { pool } from '../config/database.js';
import { validRange } from '../services/kpi-gastos.js';
import { kpiRentabilidad, kpiRentabilidadOpciones } from '../services/kpi-rentabilidad.js';
import { renderKpiRentabilidadPdf } from '../services/kpi-rentabilidad-pdf.js';
import { renderKpiRentabilidadXlsx } from '../services/kpi-rentabilidad-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router = Router();
// Período obligatorio y categoría opcional (?categoria=id). Devuelve null si son inválidos.
const params = req => {
  const { inicio, fin } = req.query, categoria = String(req.query.categoria || '');
  if (!validRange(inicio, fin) || (categoria && !/^[1-9][0-9]{0,8}$/.test(categoria))) return null;
  return { inicio, fin, categoria: categoria ? Number(categoria) : null };
};
const invalid = res => res.status(400).json({ error: 'Ingresá un rango de fechas válido' });
const fileName = (p, ext) => `rentabilidad-${p.inicio}_${p.fin}${p.categoria ? `-categoria${p.categoria}` : ''}.${ext}`;

router.get('/opciones', async (req, res, next) => { try { res.json(await kpiRentabilidadOpciones()); } catch (error) { next(error); } });

router.get('/', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try { res.json(await kpiRentabilidad(p.inicio, p.fin, { categoria: p.categoria })); } catch (error) { next(error); }
});

router.get('/reporte.pdf', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const data = await kpiRentabilidad(p.inicio, p.fin, { categoria: p.categoria });
    sendPdf(res, await renderKpiRentabilidadPdf(data, await restaurantInfo(pool)), fileName(p, 'pdf'));
  } catch (error) { next(error); }
});

router.get('/reporte.xlsx', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const file = await renderKpiRentabilidadXlsx(await kpiRentabilidad(p.inicio, p.fin, { categoria: p.categoria }), await restaurantInfo(pool));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName(p, 'xlsx')}"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.length)
    });
    res.send(file);
  } catch (error) { next(error); }
});

export default router;
