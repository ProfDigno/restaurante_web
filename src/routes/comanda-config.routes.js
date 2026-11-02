import { Router } from 'express';
import { guardarConfigComanda, leerConfigComanda } from '../services/comanda-config.js';

const router = Router();
const route = fn => async (req, res, next) => {
  try { res.json(await fn(req)); } catch (error) { if (['23514', '23505'].includes(error.code)) error.status = 400; next(error); }
};

router.get('/', route(() => leerConfigComanda()));
router.put('/', route(req => guardarConfigComanda(req.body, req.user)));

export default router;
