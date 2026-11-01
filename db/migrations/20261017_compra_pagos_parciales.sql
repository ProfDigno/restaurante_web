-- Los movimientos anteriores con fk_idcompra permanecen intactos.
CREATE SEQUENCE compra_pago_id_seq;
CREATE TABLE compra_pago (
  idcompra_pago integer PRIMARY KEY DEFAULT nextval('compra_pago_id_seq'),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL,
  fk_idcompra integer NOT NULL REFERENCES compra(idcompra),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  importe numeric(14,0) NOT NULL CHECK (importe > 0),
  estado varchar(12) NOT NULL DEFAULT 'aprobado' CHECK (estado IN ('aprobado','anulado')),
  fecha_anulado timestamp,
  anulado_por text,
  CONSTRAINT compra_pago_anulacion_valida CHECK (
    (estado='aprobado' AND fecha_anulado IS NULL AND anulado_por IS NULL) OR
    (estado='anulado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL)
  )
);
CREATE INDEX compra_pago_compra_idx ON compra_pago(fk_idcompra);
ALTER TABLE caja_item ADD COLUMN fk_idcompra_pago integer REFERENCES compra_pago(idcompra_pago);
CREATE UNIQUE INDEX caja_item_compra_pago_original_unico ON caja_item(fk_idcompra_pago) WHERE fk_idcompra_pago IS NOT NULL AND NOT es_reversion;
CREATE UNIQUE INDEX caja_item_compra_pago_reversion_unica ON caja_item(fk_idcompra_pago) WHERE fk_idcompra_pago IS NOT NULL AND es_reversion;

ALTER TABLE caja_item DROP CONSTRAINT caja_item_unico_origen;
ALTER TABLE caja_item ADD CONSTRAINT caja_item_unico_origen CHECK (
  (fk_idpago IS NOT NULL)::int + (fk_idcompra IS NOT NULL)::int +
  (fk_idgasto IS NOT NULL)::int + (fk_idvale IS NOT NULL)::int +
  (fk_idcompra_pago IS NOT NULL)::int = 1
);
ALTER TABLE caja_item DROP CONSTRAINT caja_item_unico_monto;
ALTER TABLE caja_item ADD CONSTRAINT caja_item_unico_monto CHECK (
  (fk_idpago IS NOT NULL AND monto_pago > 0)::int +
  ((fk_idcompra IS NOT NULL OR fk_idcompra_pago IS NOT NULL) AND monto_compra > 0)::int +
  (fk_idgasto IS NOT NULL AND monto_gasto > 0)::int +
  (fk_idvale IS NOT NULL AND monto_vale > 0)::int = 1 AND
  (fk_idpago IS NULL OR (monto_compra=0 AND monto_gasto=0 AND monto_vale=0)) AND
  (fk_idcompra IS NULL OR (monto_pago=0 AND monto_gasto=0 AND monto_vale=0)) AND
  (fk_idcompra_pago IS NULL OR (monto_pago=0 AND monto_gasto=0 AND monto_vale=0)) AND
  (fk_idgasto IS NULL OR (monto_pago=0 AND monto_compra=0 AND monto_vale=0)) AND
  (fk_idvale IS NULL OR (monto_pago=0 AND monto_compra=0 AND monto_gasto=0))
);
ALTER TABLE compra DROP CONSTRAINT compra_pago_valido;
ALTER TABLE compra ADD CONSTRAINT compra_pago_valido CHECK (
  importe_pagado <= total AND (
    (estado_pago='pendiente' AND (importe_pagado < total OR total=0)) OR
    (estado_pago='pagada' AND importe_pagado=total AND total>0) OR
    estado_pago='anulada'
  ) AND ((importe_pagado=0 AND fecha_pago IS NULL AND pagado_por IS NULL) OR
         (importe_pagado>0 AND fecha_pago IS NOT NULL AND pagado_por IS NOT NULL))
);

CREATE OR REPLACE FUNCTION validar_compra_operacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado='borrador' AND NEW.estado IN ('recibida','cancelada')) OR
    (OLD.estado='recibida' AND NEW.estado='cancelada')) THEN
    RAISE EXCEPTION 'Transición de compra inválida';
  END IF;
  IF NEW.estado_pago IS DISTINCT FROM OLD.estado_pago AND NOT (
    (OLD.estado_pago='pendiente' AND NEW.estado_pago IN ('pagada','anulada')) OR
    (OLD.estado_pago='pagada' AND NEW.estado_pago='anulada')) THEN
    RAISE EXCEPTION 'Transición de pago de compra inválida';
  END IF;
  IF NEW.estado_pago='pagada' AND NEW.estado<>'recibida' THEN RAISE EXCEPTION 'Solo se puede pagar una compra recibida'; END IF;
  IF OLD.estado_pago='pagada' AND NEW.estado<>'cancelada' AND
     (NEW.total IS DISTINCT FROM OLD.total OR NEW.importe_pagado IS DISTINCT FROM OLD.importe_pagado) THEN
    RAISE EXCEPTION 'Una compra pagada no puede cambiar total ni importe';
  END IF;
  RETURN NEW;
END;
$$;

-- Este validador conserva todos los orígenes anteriores y agrega pagos de compra.
CREATE OR REPLACE FUNCTION validar_caja_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_estado estado_caja_gral; v_forma integer; v_monto numeric(14,0);
  v_monto_item numeric(14,0); v_tipo tipo_movimiento_caja; v_estado_origen text;
  v_original caja_item%ROWTYPE; v_activo boolean; v_permite boolean;
BEGIN
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Los movimientos de caja son inmutables'; END IF;
  SELECT estado INTO v_estado FROM caja_gral WHERE idcaja_gral=NEW.fk_idcaja_gral FOR UPDATE;
  IF NOT FOUND OR v_estado<>'abierta' THEN RAISE EXCEPTION 'La caja no está abierta'; END IF;
  IF NEW.fk_iddevolucion_pago IS NOT NULL THEN
    SELECT p.fk_idforma_pago,d.importe INTO v_forma,v_monto FROM devolucion_pago d
      JOIN pago p ON p.idpago=d.fk_idpago WHERE d.iddevolucion_pago=NEW.fk_iddevolucion_pago AND p.idpago=NEW.fk_idpago;
    SELECT * INTO v_original FROM caja_item WHERE idcaja_item=NEW.fk_idcaja_item_origen;
    IF v_forma IS NULL OR NOT FOUND OR v_original.es_reversion OR
       v_original.fk_idpago IS DISTINCT FROM NEW.fk_idpago OR NOT NEW.es_reversion OR
       NEW.tipo_movimiento<>'egreso' OR NEW.fk_idforma_pago<>v_forma OR NEW.monto_pago<>v_monto THEN
      RAISE EXCEPTION 'Devolución de caja incompatible con el pago original'; END IF;
    INSERT INTO caja_arqueo(fk_idcaja_gral,fk_idforma_pago,creado_por)
    VALUES(NEW.fk_idcaja_gral,NEW.fk_idforma_pago,NEW.creado_por)
    ON CONFLICT(fk_idcaja_gral,fk_idforma_pago) DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.fk_idpago IS NOT NULL THEN
    SELECT fk_idforma_pago,importe,estado::text INTO v_forma,v_monto,v_estado_origen FROM pago WHERE idpago=NEW.fk_idpago;
    v_monto_item:=NEW.monto_pago; v_tipo:='ingreso';
  ELSIF NEW.fk_idcompra_pago IS NOT NULL THEN
    SELECT fk_idforma_pago,importe,estado INTO v_forma,v_monto,v_estado_origen FROM compra_pago WHERE idcompra_pago=NEW.fk_idcompra_pago;
    v_monto_item:=NEW.monto_compra; v_tipo:='egreso';
  ELSIF NEW.fk_idcompra IS NOT NULL THEN
    SELECT fk_idforma_pago,importe_pagado,estado_pago::text INTO v_forma,v_monto,v_estado_origen FROM compra WHERE idcompra=NEW.fk_idcompra;
    v_monto_item:=NEW.monto_compra; v_tipo:='egreso';
  ELSIF NEW.fk_idgasto IS NOT NULL THEN
    SELECT fk_idforma_pago,total_gasto,estado::text INTO v_forma,v_monto,v_estado_origen FROM gasto WHERE idgasto=NEW.fk_idgasto;
    v_monto_item:=NEW.monto_gasto; v_tipo:='egreso';
  ELSE
    SELECT fk_idforma_pago,monto_vale,estado::text INTO v_forma,v_monto,v_estado_origen FROM vale WHERE idvale=NEW.fk_idvale;
    v_monto_item:=NEW.monto_vale; v_tipo:='egreso';
  END IF;
  IF v_forma IS NULL THEN RAISE EXCEPTION 'El origen de caja no existe'; END IF;
  IF NEW.es_reversion THEN
    SELECT * INTO v_original FROM caja_item WHERE idcaja_item=NEW.fk_idcaja_item_origen;
    IF NOT FOUND OR v_original.es_reversion OR v_original.fk_idforma_pago<>NEW.fk_idforma_pago OR
       v_original.fk_idpago IS DISTINCT FROM NEW.fk_idpago OR
       v_original.fk_idcompra IS DISTINCT FROM NEW.fk_idcompra OR
       v_original.fk_idcompra_pago IS DISTINCT FROM NEW.fk_idcompra_pago OR
       v_original.fk_idgasto IS DISTINCT FROM NEW.fk_idgasto OR
       v_original.fk_idvale IS DISTINCT FROM NEW.fk_idvale THEN
      RAISE EXCEPTION 'La reversión no coincide con el movimiento original'; END IF;
    v_tipo:=CASE WHEN v_tipo='ingreso' THEN 'egreso'::tipo_movimiento_caja ELSE 'ingreso'::tipo_movimiento_caja END;
    IF v_estado_origen NOT IN ('anulado','anulada') THEN RAISE EXCEPTION 'El origen debe estar anulado para revertir caja'; END IF;
  ELSIF v_estado_origen NOT IN ('aprobado','pagado','pagada') THEN
    RAISE EXCEPTION 'El origen debe estar aprobado o pagado para ingresar en caja';
  END IF;
  IF NEW.tipo_movimiento<>v_tipo OR NEW.fk_idforma_pago<>v_forma OR v_monto_item<>v_monto THEN
    RAISE EXCEPTION 'El movimiento no coincide con su origen'; END IF;
  SELECT activo,CASE WHEN NEW.es_reversion THEN true WHEN NEW.tipo_movimiento='ingreso' THEN es_ingreso ELSE es_egreso END
  INTO v_activo,v_permite FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago;
  IF NOT FOUND OR NOT v_activo OR NOT v_permite THEN RAISE EXCEPTION 'La forma de pago no permite este movimiento'; END IF;
  INSERT INTO caja_arqueo(fk_idcaja_gral,fk_idforma_pago,creado_por)
  VALUES(NEW.fk_idcaja_gral,NEW.fk_idforma_pago,NEW.creado_por)
  ON CONFLICT(fk_idcaja_gral,fk_idforma_pago) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_origen_caja_automatico()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_aprobar boolean:=false; v_revertir boolean:=false; v_usuario text;
BEGIN
  IF TG_TABLE_NAME='pago' THEN
    v_aprobar:=NEW.estado='aprobado' AND (TG_OP='INSERT' OR OLD.estado<>'aprobado');
    v_revertir:=TG_OP='UPDATE' AND NEW.estado='anulado' AND OLD.estado='aprobado';
    v_usuario:=COALESCE(NEW.anulado_por,NEW.creado_por);
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('pago',NEW.idpago,NEW.fk_idforma_pago,NEW.importe,'Cobro de cuenta '||NEW.fk_idcuenta,NEW.creado_por,false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('pago',NEW.idpago,NEW.fk_idforma_pago,NEW.importe,'Reversión de cobro '||NEW.idpago,v_usuario,true); END IF;
  ELSIF TG_TABLE_NAME='compra' THEN
    IF NOT EXISTS(SELECT 1 FROM compra_pago WHERE fk_idcompra=NEW.idcompra) THEN
      v_aprobar:=NEW.estado_pago='pagada' AND (TG_OP='INSERT' OR OLD.estado_pago<>'pagada');
      v_revertir:=TG_OP='UPDATE' AND NEW.estado_pago='anulada' AND OLD.estado_pago='pagada';
      IF v_aprobar THEN PERFORM registrar_movimiento_caja('compra',NEW.idcompra,NEW.fk_idforma_pago,NEW.importe_pagado,'Pago de compra '||NEW.idcompra,NEW.pagado_por,false); END IF;
      IF v_revertir THEN PERFORM registrar_movimiento_caja('compra',NEW.idcompra,NEW.fk_idforma_pago,NEW.importe_pagado,'Reversión de compra '||NEW.idcompra,NEW.anulado_por,true); END IF;
    END IF;
  ELSIF TG_TABLE_NAME='gasto' THEN
    v_aprobar:=NEW.estado='pagado' AND (TG_OP='INSERT' OR OLD.estado<>'pagado');
    v_revertir:=TG_OP='UPDATE' AND NEW.estado='anulado' AND OLD.estado='pagado';
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('gasto',NEW.idgasto,NEW.fk_idforma_pago,NEW.total_gasto,NEW.descripcion,NEW.creado_por,false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('gasto',NEW.idgasto,NEW.fk_idforma_pago,NEW.total_gasto,'Reversión: '||NEW.descripcion,NEW.anulado_por,true); END IF;
  ELSIF TG_TABLE_NAME='vale' THEN
    v_aprobar:=NEW.estado='pagado' AND (TG_OP='INSERT' OR OLD.estado<>'pagado');
    v_revertir:=TG_OP='UPDATE' AND NEW.estado='anulado' AND OLD.estado='pagado';
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('vale',NEW.idvale,NEW.fk_idforma_pago,NEW.monto_vale,NEW.descripcion,NEW.creado_por,false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('vale',NEW.idvale,NEW.fk_idforma_pago,NEW.monto_vale,'Reversión: '||NEW.descripcion,NEW.anulado_por,true); END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_pago_compra_caja()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_caja integer; v_original integer; v_total numeric(14,0); v_pagado numeric(14,0);
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT total,importe_pagado INTO v_total,v_pagado FROM compra WHERE idcompra=NEW.fk_idcompra AND estado='recibida' FOR UPDATE;
    IF NOT FOUND OR v_pagado+NEW.importe>v_total THEN RAISE EXCEPTION 'El pago supera el saldo pendiente de la compra'; END IF;
    IF NOT EXISTS(SELECT 1 FROM forma_pago WHERE idforma_pago=NEW.fk_idforma_pago AND activo AND es_egreso) THEN RAISE EXCEPTION 'Forma de pago no habilitada para egresos'; END IF;
    SELECT idcaja_gral INTO v_caja FROM caja_gral WHERE estado='abierta' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe una caja abierta'; END IF;
    UPDATE compra SET importe_pagado=v_pagado+NEW.importe,
      estado_pago=CASE WHEN v_pagado+NEW.importe=v_total THEN 'pagada'::estado_pago_compra ELSE 'pendiente'::estado_pago_compra END,
      fecha_pago=NEW.fecha_creado,pagado_por=NEW.creado_por WHERE idcompra=NEW.fk_idcompra;
    INSERT INTO caja_item(fk_idcaja_gral,fk_idforma_pago,tipo_movimiento,descripcion,monto_compra,fk_idcompra_pago,creado_por)
    VALUES(v_caja,NEW.fk_idforma_pago,'egreso','Pago de compra '||NEW.fk_idcompra,NEW.importe,NEW.idcompra_pago,NEW.creado_por);
  ELSE
    IF OLD.estado<>'aprobado' OR NEW.estado<>'anulado' OR NEW.fk_idcompra<>OLD.fk_idcompra OR
       NEW.fk_idforma_pago<>OLD.fk_idforma_pago OR NEW.importe<>OLD.importe THEN RAISE EXCEPTION 'Pago de compra inmutable'; END IF;
    SELECT idcaja_gral INTO v_caja FROM caja_gral WHERE estado='abierta' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe una caja abierta'; END IF;
    SELECT idcaja_item INTO v_original FROM caja_item WHERE fk_idcompra_pago=NEW.idcompra_pago AND NOT es_reversion;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe egreso original de compra'; END IF;
    INSERT INTO caja_item(fk_idcaja_gral,fk_idforma_pago,tipo_movimiento,descripcion,monto_compra,fk_idcompra_pago,es_reversion,fk_idcaja_item_origen,creado_por)
    VALUES(v_caja,NEW.fk_idforma_pago,'ingreso','Reversión pago compra '||NEW.fk_idcompra,NEW.importe,NEW.idcompra_pago,true,v_original,NEW.anulado_por);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_compra_pago_caja AFTER INSERT OR UPDATE OF estado ON compra_pago
FOR EACH ROW EXECUTE PROCEDURE registrar_pago_compra_caja();
