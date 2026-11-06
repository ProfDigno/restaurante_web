import { pool } from '../config/database.js';
import { finishOrder } from './pedidos.js';
import { leerConfigComanda } from './comanda-config.js';

const kitchenLine = `EXISTS (
  SELECT 1 FROM detalle_pedido d JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
  WHERE d.fk_idpedido=p.idpedido AND d.estado<>'cancelado' AND pm.es_cocina
)`;

export async function listComandas() {
  const settings = await leerConfigComanda();
  const config = {
    colores: settings.colores.map(({ desde_minuto, color }) => ({ desde_minuto, color })),
    anulado_visible_seg: settings.anulado_visible_seg,
    refresco_seg: settings.refresco_seg,
    limite_terminado_min: settings.pase_automatico ? settings.limite_terminado_min : null
  };
  const { rows: pedidos } = await pool.query(`
    SELECT p.idpedido, p.estado, p.version_web, p.tipo_entrega, p.observacion,
      p.fecha_creado, p.fecha_anulado, m.numero AS mesa_numero,
      EXTRACT(EPOCH FROM (LOCALTIMESTAMP-p.fecha_creado))::int AS edad_segundos,
      CASE WHEN p.fecha_anulado IS NOT NULL THEN EXTRACT(EPOCH FROM (LOCALTIMESTAMP-p.fecha_anulado))::int END AS anulado_segundos
    FROM pedido p LEFT JOIN mesa m ON m.idmesa=p.fk_idmesa
    WHERE (p.estado='en_preparacion' OR (p.estado='cancelado' AND p.fecha_anulado > LOCALTIMESTAMP-make_interval(secs => $1)))
      AND ${kitchenLine}
    ORDER BY p.fecha_creado, p.idpedido`, [config.anulado_visible_seg]);
  if (!pedidos.length) return { items: [], config };
  const ids = pedidos.map(pedido => pedido.idpedido);
  const { rows: lines } = await pool.query(`
    SELECT d.iddetalle_pedido, d.fk_idpedido, d.cantidad, d.observaciones,
      pm.nombre, pm.descripcion, cm.nombre AS categoria, um.nombre AS unidad
    FROM detalle_pedido d JOIN producto_menu pm ON pm.idproducto_menu=d.fk_idproducto_menu
    JOIN categoria_menu cm ON cm.idcategoria_menu=pm.fk_idcategoria_menu
    JOIN unidad_menu um ON um.idunidad_menu=pm.fk_idunidad_menu
    WHERE d.fk_idpedido=ANY($1::int[]) AND d.estado<>'cancelado' AND pm.es_cocina
    ORDER BY d.iddetalle_pedido`, [ids]);
  const lineIds = lines.map(line => line.iddetalle_pedido);
  const { rows: changes } = await pool.query(`SELECT dpi.fk_iddetalle_pedido, dpi.tipo_modificacion, i.nombre
      FROM detalle_pedido_ingrediente dpi JOIN ingrediente i ON i.idingrediente=dpi.fk_idingrediente
      WHERE dpi.fk_iddetalle_pedido=ANY($1::int[]) AND dpi.activo ORDER BY i.nombre`, [lineIds]);
  const details = lines.map(line => {
    const edits = changes.filter(item => item.fk_iddetalle_pedido === line.iddetalle_pedido);
    return {
      iddetalle_pedido: line.iddetalle_pedido,
      fk_idpedido: line.fk_idpedido,
      cantidad: Number(line.cantidad),
      nombre: line.nombre,
      categoria: line.categoria,
      unidad: line.unidad,
      descripcion: line.descripcion,
      observaciones: line.observaciones,
      agregados: edits.filter(item => item.tipo_modificacion === 'AGREGAR').map(item => item.nombre),
      quitados: edits.filter(item => item.tipo_modificacion === 'QUITAR').map(item => item.nombre)
    };
  });
  return { config, items: pedidos.map(pedido => ({
    ...pedido,
    edad_segundos: Number(pedido.edad_segundos),
    anulado_segundos: pedido.anulado_segundos == null ? null : Number(pedido.anulado_segundos),
    detalles: details.filter(line => line.fk_idpedido === pedido.idpedido).map(({ fk_idpedido, ...line }) => line)
  })) };
}

export async function finishExpiredComandas() {
  const config = await leerConfigComanda();
  if (!config.pase_automatico) return;
  const { rows } = await pool.query(`
    SELECT p.idpedido, p.version_web FROM pedido p
    WHERE p.estado='en_preparacion' AND p.fecha_creado < LOCALTIMESTAMP-make_interval(mins => $1)
      AND ${kitchenLine}
    ORDER BY p.fecha_creado, p.idpedido`, [config.limite_terminado_min]);
  for (const pedido of rows) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await finishOrder(client, pedido.idpedido, pedido.version_web, { login: 'SISTEMA' });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.status !== 409) console.error(`Comanda #${pedido.idpedido}:`, error);
    } finally { client.release(); }
  }
}
