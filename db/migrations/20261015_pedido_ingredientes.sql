CREATE OR REPLACE FUNCTION recalcular_monto_pedido(p_idpedido integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_total numeric(14,0);
BEGIN
  SELECT (
    COALESCE((SELECT SUM(cantidad * precio_venta) FROM detalle_pedido WHERE fk_idpedido = p_idpedido AND estado <> 'cancelado'), 0) +
    COALESCE((SELECT SUM(dp.cantidad * dpi.precio_venta)
              FROM detalle_pedido_ingrediente dpi
              JOIN detalle_pedido dp ON dp.iddetalle_pedido = dpi.fk_iddetalle_pedido
              WHERE dp.fk_idpedido = p_idpedido AND dp.estado <> 'cancelado' AND dpi.activo AND dpi.tipo_modificacion = 'AGREGAR'), 0) +
    COALESCE(p.monto_delivery, 0) + COALESCE(p.monto_recargo, 0) - COALESCE(p.monto_descuento, 0)
  )::numeric(14,0) INTO v_total FROM pedido p WHERE p.idpedido = p_idpedido;
  IF v_total < 0 THEN RAISE EXCEPTION 'El descuento no puede superar el importe del pedido'; END IF;
  RETURN COALESCE(v_total, 0);
END;
$$;

UPDATE pedido SET monto_total = recalcular_monto_pedido(idpedido)
WHERE EXISTS (
  SELECT 1 FROM detalle_pedido dp
  JOIN detalle_pedido_ingrediente dpi ON dpi.fk_iddetalle_pedido = dp.iddetalle_pedido
  WHERE dp.fk_idpedido = pedido.idpedido AND dpi.activo AND dpi.tipo_modificacion = 'AGREGAR'
);
