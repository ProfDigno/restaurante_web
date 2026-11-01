import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { menuForPermissions } from '../config/menu.js';

const router = Router();
router.get('/', requireAuth, (req, res) => res.json({ sections: menuForPermissions(req.user.permisos) }));
export default router;
