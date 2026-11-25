import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { guardarConfigDefecto, leerConfigDefecto, leerConfigImpresora } from '../services/impresora-config.js';
import { dateTime, renderTicket, restaurantInfo, sendPdf, writer } from '../services/ticket-pdf.js';
import { pool } from '../config/database.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { if (['23514', '23505'].includes(error.code)) error.status = 400; next(error); }
};

// Ticket corto para probar ancho, letra y espacio en blanco antes del corte.
function pruebaLayout(doc, { config, restaurante, pc }, printedAt) {
  const { text, pair, rule, header, end, m } = writer(doc);
  header(restaurante);
  text('PRUEBA DE IMPRESIÓN', { size: 13, bold: true, align: 'center', gap: 4 });
  rule();
  if (pc) pair('PC', pc);
  pair('Papel', `${m.tamano} mm (imprime ${m.util} mm)`);
  pair('Saltos al final', String(config.saltos_final));
  if (config.nombre_impresora) pair('Impresora', config.nombre_impresora);
  pair('Impreso', dateTime(printedAt));
  rule();
  text('1234567890123456789012345678901234567890'.slice(0, m.tamano === 58 ? 30 : 40), { size: 8.5, align: 'center' });
  pair('|< borde', 'borde >|', { bold: true });
  pair('Importe de ejemplo', 'Gs. 12.345.678', { bold: true });
  text('Si ves los dos bordes y el importe completo, el ancho es correcto.', { size: 7.5, align: 'center' });
  rule();
  text('Fin del ticket · debajo queda el espacio antes del corte', { size: 7.5, align: 'center', gap: 0 });
  return end();
}

router.get('/', route(() => leerConfigDefecto()));
router.put('/', route(req => guardarConfigDefecto(req.body, req.user)));

// PDF de prueba con el papel de la terminal (?terminal=ID) o el de por defecto.
router.get('/prueba.pdf', async (req, res, next) => {
  try {
    const config = await leerConfigImpresora();
    const data = { config, restaurante: await restaurantInfo(pool), pc: String(req.query.pc || '').slice(0, 60) };
    sendPdf(res, await renderTicket(pruebaLayout, data, 'Prueba de impresión', new Date(), config), 'prueba-impresion.pdf');
  } catch (error) { next(error); }
});

// ZIP del agente de impresión para instalar en cada PC, con el origen de este sistema ya configurado.
const AGENTE = new URL('../../agente-impresion/', import.meta.url);
router.get('/agente.zip', async (req, res, next) => {
  try {
    const jar = await readFile(new URL('dist/agente-impresion.jar', AGENTE)).catch(() => null);
    if (!jar) return res.status(503).json({ error: 'El agente todavía no está compilado en el servidor (agente-impresion/compilar.bat).' });
    const origen = req.get('origin') || `${req.protocol}://${req.get('host')}`;
    const config = (await readFile(new URL('config.properties', AGENTE), 'utf8'))
      .replace(/^origenes=.*$/m, `origenes=${origen}`);
    const zip = new JSZip();
    const carpeta = zip.folder('agente-impresion');
    carpeta.file('agente-impresion.jar', jar);
    carpeta.file('config.properties', config);
    for (const nombre of ['instalar.bat', 'desinstalar.bat', 'LEEME.txt']) carpeta.file(nombre, await readFile(new URL(nombre, AGENTE)));
    const archivo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.set({ 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="agente-impresion.zip"', 'Cache-Control': 'no-store', 'Content-Length': String(archivo.length) });
    res.send(archivo);
  } catch (error) { next(error); }
});

export default router;
