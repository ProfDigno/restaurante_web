import { Router } from 'express';
import { pool } from '../config/database.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { id, operation, finishOrder } from '../services/pedidos.js';
import { listComandas } from '../services/comandas.js';
import { alCambiar } from '../services/eventos.js';

const router = Router();
router.use(requireAuth, requirePermission('comanda'));

router.get('/', async (req, res, next) => {
  try { res.set('Cache-Control', 'no-store').json(await listComandas()); }
  catch (error) { next(error); }
});

// Server-Sent Events: avisa al instante que hay cambios para que la pantalla recargue.
// X-Accel-Buffering evita que nginx retenga los avisos; el ping mantiene viva la conexión.
router.get('/eventos', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const quitar = alCambiar(() => res.write('event: cambio\ndata: {}\n\n'));
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { quitar(); clearInterval(ping); });
});

router.post('/:id/terminar', async (req, res, next) => {
  try {
    const pedidoId = id(req.params.id);
    const result = await operation(req, async client => {
      const kitchen = await client.query(`SELECT 1 FROM detalle_pedido d
        JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
        WHERE d.fk_idpedido=$1 AND d.estado<>'cancelado' AND pm.es_cocina LIMIT 1`, [pedidoId]);
      if (!kitchen.rowCount) {
        const error = new Error('El pedido no tiene productos de cocina');
        error.status = 409;
        throw error;
      }
      const { pedido } = await finishOrder(client, pedidoId, id(req.body.version_web), req.user);
      return { idpedido: pedido.idpedido, estado: pedido.estado };
    });
    res.json(result);
  } catch (error) { next(error); }
});

export default router;
