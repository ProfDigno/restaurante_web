CREATE OR REPLACE FUNCTION validar_transicion_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'abierto' AND NEW.estado IN ('confirmado', 'cancelado')) OR
      (OLD.estado = 'confirmado' AND NEW.estado IN ('en_preparacion', 'cancelado')) OR
      (OLD.estado = 'en_preparacion' AND NEW.estado IN ('listo', 'cancelado')) OR
      (OLD.estado = 'listo' AND NEW.estado IN ('entregado', 'pagado', 'cancelado')) OR
      (OLD.estado = 'entregado' AND NEW.estado = 'pagado') OR
      (OLD.estado IN ('entregado','pagado') AND NEW.estado = 'cancelado')
    ) THEN RAISE EXCEPTION 'Transición de pedido inválida: % a %', OLD.estado, NEW.estado; END IF;
  END IF;
  IF NEW.estado = 'confirmado' AND (NEW.fecha_confirmado IS NULL OR NEW.confirmado_por IS NULL) THEN
    RAISE EXCEPTION 'La confirmación requiere fecha y usuario';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cerrar_cuenta_mesa(p_idcuenta integer, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cuenta cuenta%ROWTYPE; v_total numeric(14,0); v_pagado numeric(14,0);
BEGIN
  SELECT * INTO v_cuenta FROM cuenta WHERE idcuenta = p_idcuenta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta % no existe', p_idcuenta; END IF;
  IF v_cuenta.estado = 'cerrada' THEN RAISE EXCEPTION 'La cuenta % ya está cerrada', p_idcuenta; END IF;
  v_total := calcular_total_cuenta(p_idcuenta);
  v_pagado := cobrado_neto_cuenta(p_idcuenta);
  IF v_pagado <> v_total THEN RAISE EXCEPTION 'La cuenta requiere pago exacto: total %, pagado %', v_total, v_pagado; END IF;
  IF EXISTS (SELECT 1 FROM pedido WHERE fk_idcuenta = p_idcuenta AND estado NOT IN ('listo', 'entregado', 'pagado', 'cancelado')) THEN RAISE EXCEPTION 'Todos los pedidos deben estar terminados o anulados'; END IF;
  UPDATE pedido SET estado = 'pagado', version_web = version_web + 1
  WHERE fk_idcuenta = p_idcuenta AND estado IN ('listo', 'entregado');
  UPDATE cuenta SET estado = 'cerrada', total = v_total, fecha_cierre = CURRENT_TIMESTAMP, cerrado_por = p_creado_por WHERE idcuenta = p_idcuenta;
  IF v_cuenta.fk_idmesa IS NOT NULL THEN UPDATE mesa SET estado = 'libre' WHERE idmesa = v_cuenta.fk_idmesa; END IF;
END;
$$;

-- Historical rows belong to already closed accounts. The normal delivery validator
-- intentionally rejects edits there, so suspend only that validator for this backfill.
ALTER TABLE pedido DISABLE TRIGGER trg_validar_pedido_entrega;
UPDATE pedido p
SET estado = 'pagado', version_web = version_web + 1
FROM cuenta c
WHERE c.idcuenta = p.fk_idcuenta
  AND c.estado = 'cerrada'
  AND p.estado IN ('listo', 'entregado')
  AND cobrado_neto_cuenta(c.idcuenta) = c.total;
ALTER TABLE pedido ENABLE TRIGGER trg_validar_pedido_entrega;
