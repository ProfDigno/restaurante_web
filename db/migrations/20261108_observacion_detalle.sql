-- Observación por producto de cocina en el pedido ("Obs: sin sal"), con precio opcional por unidad.
-- El texto usa la columna existente detalle_pedido.observaciones; el precio va en precio_observacion
-- y suma al total del pedido (cantidad × precio_observacion), igual que los ingredientes agregados.
-- Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='detalle_pedido' AND column_name='precio_observacion') THEN
    ALTER TABLE detalle_pedido ADD COLUMN precio_observacion numeric(14,0) NOT NULL DEFAULT 0
      CONSTRAINT detalle_pedido_precio_observacion_valido CHECK (precio_observacion >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION recalcular_monto_pedido(p_idpedido integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_total numeric(14,0);
BEGIN
  SELECT (
    COALESCE((SELECT SUM(cantidad * (precio_venta + precio_observacion)) FROM detalle_pedido WHERE fk_idpedido = p_idpedido AND estado <> 'cancelado'), 0) +
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
