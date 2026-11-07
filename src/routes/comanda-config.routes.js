import { Router } from 'express';
import { guardarConfigComanda, leerConfigComanda } from '../services/comanda-config.js';
import { avisarCambio } from '../services/eventos.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { if (['23514', '23505'].includes(error.code)) error.status = 400; next(error); }
};

router.get('/', route(() => leerConfigComanda()));
// Avisa a las pantallas de cocina abiertas para que tomen la configuración nueva.
router.put('/', route(async req => { const saved = await guardarConfigComanda(req.body, req.user); avisarCambio(); return saved; }));

export default router;
