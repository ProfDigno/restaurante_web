import { pool } from '../config/database.js';
import { fail } from './pedidos.js';
import { entregaTexto, productName } from './pedido-ticket.js';
import { dateTime, medidasTicket, medirTicket, muted, quantity, renderTicket, writer } from './ticket-pdf.js';

// Ticket de comanda: lo que prepara la cocina, sin precios, y al final los insumos de todo el pedido sumados.
const deCocina = pedido => (pedido.detalles || []).filter(line => line.es_cocina);
export const tieneComanda = pedido => pedido.estado !== 'cancelado' && deCocina(pedido).length > 0;
export const llevaComanda = (pedido, config) => config.imprime_comanda === true && tieneComanda(pedido);

// cantidad pedida × cantidad del insumo en el producto, sumado por id del insumo (no por nombre).
// Se suma en SQL con numeric: 3 × 0,1 da 0,3 exacto.
async function insumosDelPedido(c, pedidoId) {
  return (await c.query(`SELECT i.idinsumo, i.nombre, u.codigo AS unidad_codigo, SUM(d.cantidad * pi.cantidad) AS cantidad
    FROM detalle_pedido d
    JOIN producto_menu pm ON pm.idproducto_menu = d.fk_idproducto_menu
    JOIN producto_menu_insumo pi ON pi.fk_idproducto_menu = d.fk_idproducto_menu
    JOIN insumo i ON i.idinsumo = pi.fk_idinsumo
    JOIN unidad_medida u ON u.idunidad_medida = i.fk_idunidad_medida
    WHERE d.fk_idpedido = $1 AND d.estado <> 'cancelado' AND pm.es_cocina
    GROUP BY i.idinsumo, i.nombre, u.codigo
    ORDER BY i.nombre, i.idinsumo`, [pedidoId])).rows;
}

export async function datosComanda(pedido, c = pool) {
  if (pedido.estado === 'cancelado') fail('Un pedido anulado no tiene comanda', 409);
  const lineas = deCocina(pedido);
  if (!lineas.length) fail('El pedido no tiene productos de cocina', 409);
  return { pedido, lineas, insumos: await insumosDelPedido(c, pedido.idpedido) };
}

export function comandaLayout(doc, { pedido, lineas, insumos }) {
  const { text, pair, rule, end, m } = writer(doc);
  text(`PEDIDO #${pedido.idpedido}`, { size: 13, bold: true, gap: 4 });
  text(`Fecha: ${dateTime(pedido.fecha_confirmado || pedido.fecha_creado)}`);
  text(`Cliente: ${pedido.cliente?.nombre_completo || 'Sin cliente'}`);
  text(`Entrega: ${entregaTexto(pedido.tipo_entrega)}`);
  if (pedido.tipo_entrega === 'COMER_ACA' && pedido.numero_mesa) text(`Mesa: ${pedido.numero_mesa}`);
  rule();
  lineas.forEach((line, index) => {
    const ultimo = index === lineas.length - 1;
    const ingredientes = line.ingredientes || [];
    text(`(${quantity(line.cantidad)}) ${productName(line)}`, { size: 9.5, bold: true, gap: ingredientes.length || line.observaciones ? 2 : ultimo ? 1 : 6 });
    // Con, Sin y Obs como en el ticket de pedido, sin importes.
    ingredientes.forEach((item, position) => text(`${item.tipo_modificacion === 'QUITAR' ? 'Sin' : 'Con'} ${item.nombre}`,
      { size: 7.5, color: muted, indent: 8, gap: position === ingredientes.length - 1 && !line.observaciones && !ultimo ? 6 : 1 }));
    if (line.observaciones) text(`Obs: ${line.observaciones}`, { size: 7.5, bold: true, indent: 8, gap: ultimo ? 1 : 6 });
  });
  if (pedido.observacion) { rule(); text(`Observación: ${pedido.observacion}`, { bold: true }); }
  if (insumos.length) {
    rule();
    text('INSUMOS', { size: 9, bold: true, gap: 5 });
    for (const insumo of insumos) pair(insumo.nombre, `${quantity(insumo.cantidad)} ${insumo.unidad_codigo}`, { bold: true, leftRatio: .68 });
  }
  rule();
  // La página tiene que quedar más alta que ancha; si no, el driver o el navegador la giran.
  return Math.max(end(), m.WIDTH + 3 - m.relleno);
}

export async function renderComandaTicket(pedido, config) {
  const datos = await datosComanda(pedido);
  return renderTicket(comandaLayout, datos, `Comanda pedido #${pedido.idpedido}`, new Date(), config);
}

// La comanda como página siguiente del PDF del pedido (para imprimir desde el navegador).
export async function paginaComanda(pedido, config) {
  const datos = await datosComanda(pedido);
  const m = await medidasTicket(config);
  const altos = medirTicket(comandaLayout, datos, m);
  return {
    size: [m.WIDTH, altos[0]],
    dibujar(doc) {
      doc.ticket = m;
      doc.altos = altos;
      comandaLayout(doc, datos);
    }
  };
}
