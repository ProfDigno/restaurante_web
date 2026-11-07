import { Router } from 'express';
import { pool } from '../config/database.js';
import { validRange } from '../services/kpi-gastos.js';
import { kpiVales, kpiValesOpciones } from '../services/kpi-vales.js';
import { renderKpiValesPdf } from '../services/kpi-vales-pdf.js';
import { renderKpiValesXlsx } from '../services/kpi-vales-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router = Router();
// Período obligatorio y persona opcional (?personal=id). Devuelve null si son inválidos.
const params = req => {
  const { inicio, fin } = req.query, personal = String(req.query.personal || '');
  if (!validRange(inicio, fin) || (personal && !/^[1-9][0-9]{0,8}$/.test(personal))) return null;
  return { inicio, fin, personal: personal ? Number(personal) : null };
};
const invalid = res => res.status(400).json({ error: 'Ingresá un rango de fechas válido' });
const fileName = (p, ext) => `analisis-vales-${p.inicio}_${p.fin}${p.personal ? `-personal${p.personal}` : ''}.${ext}`;

router.get('/opciones', async (req, res, next) => { try { res.json(await kpiValesOpciones()); } catch (error) { next(error); } });

router.get('/', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const { vales, ...data } = await kpiVales(p.inicio, p.fin, { personal: p.personal });
    res.json(data);
  } catch (error) { next(error); }
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const data = await kpiVales(p.inicio, p.fin, { detalle: true, personal: p.personal });
    sendPdf(res, await renderKpiValesPdf(data, await restaurantInfo(pool)), fileName(p, 'pdf'));
  } catch (error) { next(error); }
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx', async (req, res, next) => {
  const p = params(req);
  if (!p) return invalid(res);
  try {
    const file = await renderKpiValesXlsx(await kpiVales(p.inicio, p.fin, { detalle: true, personal: p.personal }), await restaurantInfo(pool));
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
