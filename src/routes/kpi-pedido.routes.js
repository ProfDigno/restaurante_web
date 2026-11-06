import { Router } from 'express';
import { pool } from '../config/database.js';
import { validRange } from '../services/kpi-gastos.js';
import { kpiPedidos } from '../services/kpi-pedidos.js';
import { renderKpiPedidosPdf } from '../services/kpi-pedidos-pdf.js';
import { renderKpiPedidosXlsx } from '../services/kpi-pedidos-xlsx.js';
import { restaurantInfo, sendPdf } from '../services/ticket-pdf.js';

const router = Router();
const invalid = res => res.status(400).json({ error: 'Ingresá un rango de fechas válido' });

router.get('/', async (req, res, next) => {
  const { inicio, fin } = req.query;
  if (!validRange(inicio, fin)) return invalid(res);
  try {
    const { semana, lista, ...data } = await kpiPedidos(inicio, fin);
    res.json(data);
  } catch (error) { next(error); }
});

// PDF: se abre en el navegador (inline).
router.get('/reporte.pdf', async (req, res, next) => {
  const { inicio, fin } = req.query;
  if (!validRange(inicio, fin)) return invalid(res);
  try {
    const data = await kpiPedidos(inicio, fin, { detalle: true });
    sendPdf(res, await renderKpiPedidosPdf(data, await restaurantInfo(pool)), `analisis-pedidos-${inicio}_${fin}.pdf`);
  } catch (error) { next(error); }
});

// Excel: se descarga (attachment).
router.get('/reporte.xlsx', async (req, res, next) => {
  const { inicio, fin } = req.query;
  if (!validRange(inicio, fin)) return invalid(res);
  try {
    const file = await renderKpiPedidosXlsx(await kpiPedidos(inicio, fin, { detalle: true }), await restaurantInfo(pool));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="analisis-pedidos-${inicio}_${fin}.xlsx"`,
      'Cache-Control': 'no-store',
      'Content-Length': String(file.length)
    });
    res.send(file);
  } catch (error) { next(error); }
});

export default router;
