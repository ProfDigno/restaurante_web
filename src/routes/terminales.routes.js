import { Router } from 'express';
import { requirePermission } from '../middleware/auth.js';
import { guardarTerminal, listarTerminales, registrarTerminal } from '../services/terminales.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { if (['23514', '23505'].includes(error.code)) error.status = 400; next(error); }
};

// Cualquier usuario con sesión: el navegador avisa en qué PC está (según el agente de impresión).
router.post('/registrar', route(req => registrarTerminal(req.body, req.user)));
router.get('/', requirePermission('configuracion-impresora'), route(() => listarTerminales()));
router.put('/:id', requirePermission('configuracion-impresora'), route(req => guardarTerminal(req.params.id, req.body, req.user)));

export default router;
