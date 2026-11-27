-- Cierre de caja por arqueo real: billetes contados por denominación + resumen de cada máquina POS.
-- Diferencia = (billetes + monedas − saldo inicial + egresos en efectivo) + POS − total vendido con delivery.
-- Los valores del cierre quedan guardados en caja_gral (NULL en las cajas cerradas antes de este cambio).
-- También agrega cambiar_forma_cobro_cuenta: corrige la forma de pago de una cuenta ya cobrada.
-- Compatible con PostgreSQL 9.5 e idempotente.
CREATE TABLE IF NOT EXISTS caja_cierre_billete (
  fk_idcaja_gral integer NOT NULL REFERENCES caja_gral(idcaja_gral),
  denominacion integer NOT NULL CHECK (denominacion > 0),
  cantidad integer NOT NULL CHECK (cantidad >= 0),
  PRIMARY KEY (fk_idcaja_gral, denominacion)
);

CREATE TABLE IF NOT EXISTS caja_cierre_pos (
  fk_idcaja_gral integer NOT NULL REFERENCES caja_gral(idcaja_gral),
  fk_idmaquina_pos integer NOT NULL REFERENCES maquina_pos(idmaquina_pos),
  monto numeric(14,0) NOT NULL CHECK (monto >= 0),
  PRIMARY KEY (fk_idcaja_gral, fk_idmaquina_pos)
);

DO $$
DECLARE v_col text;
BEGIN
  FOREACH v_col IN ARRAY ARRAY['cierre_billetes','cierre_monedas','cierre_pos','cierre_egresos','cierre_vendido','cierre_delivery','cierre_diferencia'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='caja_gral' AND column_name=v_col) THEN
      EXECUTE format('ALTER TABLE caja_gral ADD COLUMN %I numeric(14,0)', v_col);
    END IF;
  END LOOP;
END $$;

-- Un pago anticipado por pedido, sin contar los anulados (al corregir la forma se anula y se registra otro).
DROP INDEX IF EXISTS pago_anticipado_pedido_unico;
CREATE UNIQUE INDEX pago_anticipado_pedido_unico ON pago (fk_idpedido) WHERE fk_idpedido IS NOT NULL AND estado <> 'anulado';

-- Corrige la forma de pago de una cuenta ya cobrada (por ejemplo, el entregador cobró con POS lo que el cajero
-- cargó en efectivo). Los pagos aprobados no se pueden tocar con la cuenta cerrada, así que se reabre un instante,
-- se anulan sus pagos (la caja registra las reversiones), se cobra el mismo total con la forma nueva y se vuelve
-- a cerrar con la fecha y el usuario de cierre originales.
CREATE OR REPLACE FUNCTION cambiar_forma_cobro_cuenta(p_idcuenta integer, p_idforma_pago integer, p_usuario text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cuenta cuenta%ROWTYPE; v_total numeric(14,0); v_pedido integer;
BEGIN
  SELECT * INTO v_cuenta FROM cuenta WHERE idcuenta = p_idcuenta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta % no existe', p_idcuenta; END IF;
  SELECT COALESCE(sum(importe), 0) INTO v_total FROM pago WHERE fk_idcuenta = p_idcuenta AND estado = 'aprobado';
  IF v_total <= 0 THEN RAISE EXCEPTION 'La cuenta % no tiene cobros para corregir', p_idcuenta; END IF;
  -- Si era un pago anticipado del pedido, el cobro nuevo lo sigue siendo.
  SELECT min(fk_idpedido) INTO v_pedido FROM pago WHERE fk_idcuenta = p_idcuenta AND estado = 'aprobado';
  IF v_cuenta.estado = 'cerrada' THEN UPDATE cuenta SET estado = 'abierta', fecha_cierre = NULL, cerrado_por = NULL WHERE idcuenta = p_idcuenta; END IF;
  UPDATE pago SET estado = 'anulado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_usuario, motivo_anulado = p_motivo
  WHERE fk_idcuenta = p_idcuenta AND estado = 'aprobado';
  INSERT INTO pago (fk_idcuenta, fk_idpedido, fk_idforma_pago, importe, estado, creado_por) VALUES (p_idcuenta, v_pedido, p_idforma_pago, v_total, 'aprobado', p_usuario);
  IF v_cuenta.estado = 'cerrada' THEN
    UPDATE cuenta SET estado = 'cerrada', fecha_cierre = v_cuenta.fecha_cierre, cerrado_por = v_cuenta.cerrado_por WHERE idcuenta = p_idcuenta;
  END IF;
END;
$$;
