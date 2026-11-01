-- Pedidos web: migración aditiva PostgreSQL 9.5. Ejecutar una vez.
CREATE SEQUENCE devolucion_pago_id_seq;
CREATE TABLE devolucion_pago (
 iddevolucion_pago integer PRIMARY KEY DEFAULT nextval('devolucion_pago_id_seq'),
 fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 creado_por text NOT NULL,
 fk_idpedido integer NOT NULL REFERENCES pedido(idpedido),
 fk_idpago integer NOT NULL REFERENCES pago(idpago),
 importe numeric(14,0) NOT NULL CHECK (importe > 0),
 motivo text NOT NULL CHECK (length(trim(motivo)) > 0)
);
CREATE INDEX devolucion_pago_pago ON devolucion_pago(fk_idpago);
CREATE INDEX devolucion_pago_pedido ON devolucion_pago(fk_idpedido);
CREATE SEQUENCE operacion_web_id_seq;
CREATE TABLE operacion_web (
 idoperacion_web integer PRIMARY KEY DEFAULT nextval('operacion_web_id_seq'),
 fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 creado_por text NOT NULL,
 clave varchar(120) NOT NULL UNIQUE,
 solicitud jsonb NOT NULL,
 respuesta jsonb NOT NULL
);
ALTER TABLE pedido ADD COLUMN version_web integer NOT NULL DEFAULT 1;
ALTER TABLE caja_item ADD COLUMN fk_iddevolucion_pago integer REFERENCES devolucion_pago(iddevolucion_pago);
CREATE UNIQUE INDEX caja_item_devolucion_unica ON caja_item(fk_iddevolucion_pago);
DROP INDEX caja_item_reversion_unica;
CREATE UNIQUE INDEX caja_item_reversion_unica ON caja_item(fk_idcaja_item_origen)
 WHERE fk_idcaja_item_origen IS NOT NULL AND fk_iddevolucion_pago IS NULL;
CREATE OR REPLACE FUNCTION cobrado_neto_cuenta(p_idcuenta integer)
RETURNS numeric LANGUAGE sql STABLE AS $$
 SELECT COALESCE((SELECT SUM(importe) FROM pago WHERE fk_idcuenta=$1 AND estado='aprobado'),0)
 - COALESCE((SELECT SUM(d.importe) FROM devolucion_pago d JOIN pago p ON p.idpago=d.fk_idpago WHERE p.fk_idcuenta=$1),0);
$$;
CREATE OR REPLACE FUNCTION validar_pedido_entrega()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_precio_delivery numeric(14,0); v_tipo_cuenta tipo_cuenta; v_estado_cuenta estado_cuenta;
  v_mesa_cuenta integer; v_cliente_cuenta integer; v_direccion varchar(250); v_telefono varchar(40);
  v_zona_codigo varchar(30); v_zona_nombre varchar(100); v_entregador_activo boolean;
BEGIN
  -- La anulación conserva íntegra la venta histórica, incluso en cuentas cerradas.
  IF TG_OP = 'UPDATE' AND NEW.estado = 'cancelado' AND OLD.estado <> 'cancelado' AND
     (to_jsonb(NEW) - 'estado' - 'fecha_anulado' - 'anulado_por' - 'motivo_anulado') =
     (to_jsonb(OLD) - 'estado' - 'fecha_anulado' - 'anulado_por' - 'motivo_anulado') THEN
    RETURN NEW;
  END IF;
  SELECT tipo, estado, fk_idmesa, fk_idcliente INTO v_tipo_cuenta, v_estado_cuenta, v_mesa_cuenta, v_cliente_cuenta
  FROM cuenta WHERE idcuenta = NEW.fk_idcuenta;
  IF NOT FOUND OR v_estado_cuenta <> 'abierta' THEN RAISE EXCEPTION 'La cuenta no existe o está cerrada'; END IF;
  IF (NEW.tipo_entrega = 'COMER_ACA' AND v_tipo_cuenta <> 'SALON') OR
     (NEW.tipo_entrega = 'DELIVERY' AND v_tipo_cuenta <> 'DELIVERY') OR
     (NEW.tipo_entrega = 'BUSCAR' AND v_tipo_cuenta <> 'BUSCAR') THEN
    RAISE EXCEPTION 'El tipo de pedido no coincide con el tipo de cuenta';
  END IF;
  IF NEW.tipo_entrega = 'COMER_ACA' THEN
    IF NEW.fk_idmesa IS DISTINCT FROM v_mesa_cuenta THEN RAISE EXCEPTION 'La mesa del pedido no coincide con la cuenta'; END IF;
    IF NOT EXISTS (SELECT 1 FROM mesa WHERE idmesa = NEW.fk_idmesa AND activa AND estado = 'ocupado') THEN RAISE EXCEPTION 'La mesa no está activa y ocupada'; END IF;
  ELSE
    NEW.fk_idmesa := NULL;
  END IF;
  IF NEW.fk_idcliente IS NULL THEN NEW.fk_idcliente := v_cliente_cuenta; END IF;
  IF v_cliente_cuenta IS NOT NULL AND NEW.fk_idcliente IS DISTINCT FROM v_cliente_cuenta THEN RAISE EXCEPTION 'El cliente del pedido no coincide con la cuenta'; END IF;
  IF NEW.tipo_entrega = 'DELIVERY' THEN
    IF NEW.fk_idcliente IS NULL THEN RAISE EXCEPTION 'DELIVERY requiere cliente'; END IF;
    SELECT c.direccion, c.telefono, z.codigo, z.nombre, z.precio_delivery
    INTO v_direccion, v_telefono, v_zona_codigo, v_zona_nombre, v_precio_delivery
    FROM cliente c JOIN zona_cliente z ON z.idzona_cliente = c.fk_idzona_cliente AND z.activo
    WHERE c.idcliente = NEW.fk_idcliente;
    IF NOT FOUND OR v_direccion IS NULL OR v_telefono IS NULL THEN RAISE EXCEPTION 'El cliente DELIVERY requiere dirección, teléfono y zona activa'; END IF;
    IF TG_OP = 'INSERT' OR NEW.fk_idcliente IS DISTINCT FROM OLD.fk_idcliente THEN
      NEW.direccion_entrega := v_direccion; NEW.telefono_entrega := v_telefono;
      NEW.zona_codigo := v_zona_codigo; NEW.zona_nombre := v_zona_nombre;
      IF NEW.monto_delivery = 0 THEN NEW.monto_delivery := v_precio_delivery; END IF;
    END IF;
    IF NEW.fk_identregador_delivery IS NOT NULL THEN
      SELECT activo INTO v_entregador_activo FROM entregador_delivery WHERE identregador_delivery = NEW.fk_identregador_delivery;
      IF NOT FOUND OR NOT v_entregador_activo THEN RAISE EXCEPTION 'El entregador no existe o está inactivo'; END IF;
    END IF;
  ELSE
    NEW.monto_delivery := 0; NEW.fk_identregador_delivery := NULL;
    NEW.direccion_entrega := NULL; NEW.telefono_entrega := NULL; NEW.zona_codigo := NULL; NEW.zona_nombre := NULL;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validar_transicion_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'abierto' AND NEW.estado IN ('confirmado', 'cancelado')) OR
      (OLD.estado = 'confirmado' AND NEW.estado IN ('en_preparacion', 'cancelado')) OR
      (OLD.estado = 'en_preparacion' AND NEW.estado IN ('listo', 'cancelado')) OR
      (OLD.estado = 'listo' AND NEW.estado IN ('entregado', 'cancelado')) OR
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
  UPDATE cuenta SET estado = 'cerrada', total = v_total, fecha_cierre = CURRENT_TIMESTAMP, cerrado_por = p_creado_por WHERE idcuenta = p_idcuenta;
  IF v_cuenta.fk_idmesa IS NOT NULL THEN UPDATE mesa SET estado = 'libre' WHERE idmesa = v_cuenta.fk_idmesa; END IF;
END;
$$;
CREATE OR REPLACE FUNCTION actualizar_estado_pago()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_total numeric(14,0); v_pagado numeric(14,0); v_activo boolean; v_ingreso boolean; v_estado_cuenta estado_cuenta;
BEGIN
  SELECT activo, es_ingreso INTO v_activo, v_ingreso FROM forma_pago WHERE idforma_pago = NEW.fk_idforma_pago;
  IF NOT FOUND OR NOT v_activo OR NOT v_ingreso THEN RAISE EXCEPTION 'La forma de pago no está activa para ingresos'; END IF;
  SELECT estado, total INTO v_estado_cuenta, v_total FROM cuenta WHERE idcuenta = NEW.fk_idcuenta FOR UPDATE;
  IF NOT FOUND OR v_estado_cuenta <> 'abierta' THEN RAISE EXCEPTION 'La cuenta no existe o está cerrada'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN ('aprobado', 'rechazado', 'anulado')) OR
    (OLD.estado = 'aprobado' AND NEW.estado = 'anulado')
  ) THEN RAISE EXCEPTION 'Transición de pago inválida: % a %', OLD.estado, NEW.estado; END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'aprobado' AND
     (NEW.fk_idcuenta IS DISTINCT FROM OLD.fk_idcuenta OR NEW.fk_idforma_pago IS DISTINCT FROM OLD.fk_idforma_pago OR NEW.importe IS DISTINCT FROM OLD.importe) THEN
    RAISE EXCEPTION 'Un pago aprobado no puede cambiar cuenta, forma ni importe';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND EXISTS
    (SELECT 1 FROM devolucion_pago WHERE fk_idpago = OLD.idpago) THEN
    RAISE EXCEPTION 'El pago tiene devoluciones parciales; no admite reversión completa';
  END IF;
  IF NEW.estado = 'aprobado' THEN
    SELECT COALESCE(SUM(importe), 0) INTO v_pagado FROM pago
    WHERE fk_idcuenta = NEW.fk_idcuenta AND estado = 'aprobado' AND idpago <> COALESCE(NEW.idpago, 0);
    IF v_pagado - COALESCE((SELECT SUM(d.importe) FROM devolucion_pago d JOIN pago p ON p.idpago=d.fk_idpago WHERE p.fk_idcuenta=NEW.fk_idcuenta),0) + NEW.importe > v_total THEN RAISE EXCEPTION 'El pago supera el saldo pendiente de la cuenta'; END IF;
    IF NEW.pagado_at IS NULL THEN NEW.pagado_at = CURRENT_TIMESTAMP; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validar_caja_item()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_estado estado_caja_gral;
  v_forma integer;
  v_monto numeric(14,0);
  v_monto_item numeric(14,0);
  v_tipo tipo_movimiento_caja;
  v_estado_origen text;
  v_original caja_item%ROWTYPE;
  v_forma_activa boolean;
  v_permite_tipo boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Los movimientos de caja son inmutables'; END IF;
  SELECT estado INTO v_estado FROM caja_gral WHERE idcaja_gral = NEW.fk_idcaja_gral FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La caja % no existe', NEW.fk_idcaja_gral; END IF;
  IF v_estado <> 'abierta' THEN RAISE EXCEPTION 'La caja % está cerrada', NEW.fk_idcaja_gral; END IF;

  IF NEW.fk_iddevolucion_pago IS NOT NULL THEN
    SELECT p.fk_idforma_pago, d.importe INTO v_forma, v_monto
    FROM devolucion_pago d JOIN pago p ON p.idpago=d.fk_idpago
    WHERE d.iddevolucion_pago=NEW.fk_iddevolucion_pago AND p.idpago=NEW.fk_idpago;
    SELECT * INTO v_original FROM caja_item WHERE idcaja_item=NEW.fk_idcaja_item_origen;
    IF v_forma IS NULL OR NOT FOUND OR v_original.es_reversion OR
       v_original.fk_idpago IS DISTINCT FROM NEW.fk_idpago OR
       NOT NEW.es_reversion OR NEW.tipo_movimiento <> 'egreso' OR
       NEW.fk_idforma_pago <> v_forma OR NEW.monto_pago <> v_monto THEN
      RAISE EXCEPTION 'Devolución de caja incompatible con el pago original';
    END IF;
    INSERT INTO caja_arqueo (fk_idcaja_gral,fk_idforma_pago,creado_por)
    VALUES (NEW.fk_idcaja_gral,NEW.fk_idforma_pago,NEW.creado_por)
    ON CONFLICT (fk_idcaja_gral,fk_idforma_pago) DO NOTHING;
    RETURN NEW;
  END IF;
  IF NEW.fk_idpago IS NOT NULL THEN
    SELECT fk_idforma_pago, importe, estado::text INTO v_forma, v_monto, v_estado_origen FROM pago WHERE idpago = NEW.fk_idpago;
    IF NOT FOUND THEN RAISE EXCEPTION 'El pago % no existe', NEW.fk_idpago; END IF;
    v_monto_item := NEW.monto_pago;
    v_tipo := 'ingreso';
  ELSIF NEW.fk_idcompra IS NOT NULL THEN
    SELECT fk_idforma_pago, importe_pagado, estado_pago::text INTO v_forma, v_monto, v_estado_origen FROM compra WHERE idcompra = NEW.fk_idcompra;
    IF NOT FOUND THEN RAISE EXCEPTION 'La compra % no existe', NEW.fk_idcompra; END IF;
    v_monto_item := NEW.monto_compra;
    v_tipo := 'egreso';
  ELSIF NEW.fk_idgasto IS NOT NULL THEN
    SELECT fk_idforma_pago, total_gasto, estado::text INTO v_forma, v_monto, v_estado_origen FROM gasto WHERE idgasto = NEW.fk_idgasto;
    IF NOT FOUND THEN RAISE EXCEPTION 'El gasto % no existe', NEW.fk_idgasto; END IF;
    v_monto_item := NEW.monto_gasto;
    v_tipo := 'egreso';
  ELSE
    SELECT fk_idforma_pago, monto_vale, estado::text INTO v_forma, v_monto, v_estado_origen FROM vale WHERE idvale = NEW.fk_idvale;
    IF NOT FOUND THEN RAISE EXCEPTION 'El vale % no existe', NEW.fk_idvale; END IF;
    v_monto_item := NEW.monto_vale;
    v_tipo := 'egreso';
  END IF;

  IF NEW.es_reversion THEN
    SELECT * INTO v_original FROM caja_item WHERE idcaja_item = NEW.fk_idcaja_item_origen;
    IF NOT FOUND OR v_original.es_reversion THEN RAISE EXCEPTION 'El movimiento original de caja no es válido'; END IF;
    IF v_original.fk_idforma_pago <> NEW.fk_idforma_pago OR
       v_original.fk_idpago IS DISTINCT FROM NEW.fk_idpago OR
       v_original.fk_idcompra IS DISTINCT FROM NEW.fk_idcompra OR
       v_original.fk_idgasto IS DISTINCT FROM NEW.fk_idgasto OR
       v_original.fk_idvale IS DISTINCT FROM NEW.fk_idvale THEN
      RAISE EXCEPTION 'La reversión no coincide con el movimiento original';
    END IF;
    v_tipo := CASE WHEN v_tipo = 'ingreso' THEN 'egreso'::tipo_movimiento_caja ELSE 'ingreso'::tipo_movimiento_caja END;
    IF v_estado_origen NOT IN ('anulado', 'anulada') THEN RAISE EXCEPTION 'El origen debe estar anulado para revertir caja'; END IF;
  ELSIF v_estado_origen NOT IN ('aprobado', 'pagado', 'pagada') THEN
    RAISE EXCEPTION 'El origen debe estar aprobado o pagado para ingresar en caja';
  END IF;
  IF NEW.tipo_movimiento <> v_tipo THEN RAISE EXCEPTION 'El tipo de movimiento no coincide con su origen'; END IF;
  IF NEW.fk_idforma_pago <> v_forma THEN RAISE EXCEPTION 'La forma de pago no coincide con el origen'; END IF;
  IF v_monto_item <> v_monto THEN RAISE EXCEPTION 'El monto específico de caja debe coincidir con el origen'; END IF;
  SELECT activo, CASE WHEN NEW.es_reversion THEN true WHEN NEW.tipo_movimiento = 'ingreso' THEN es_ingreso ELSE es_egreso END
  INTO v_forma_activa, v_permite_tipo FROM forma_pago WHERE idforma_pago = NEW.fk_idforma_pago;
  IF NOT FOUND OR NOT v_forma_activa OR NOT v_permite_tipo THEN RAISE EXCEPTION 'La forma de pago no permite este movimiento'; END IF;
  INSERT INTO caja_arqueo (fk_idcaja_gral, fk_idforma_pago, creado_por)
  VALUES (NEW.fk_idcaja_gral, NEW.fk_idforma_pago, NEW.creado_por)
  ON CONFLICT (fk_idcaja_gral, fk_idforma_pago) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validar_edicion_detalle_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_idpedido integer; v_estado estado_pedido; v_estado_cuenta estado_cuenta;
BEGIN
  v_idpedido := COALESCE(NEW.fk_idpedido, OLD.fk_idpedido);
  SELECT p.estado, c.estado INTO v_estado, v_estado_cuenta
  FROM pedido p JOIN cuenta c ON c.idcuenta = p.fk_idcuenta WHERE p.idpedido = v_idpedido;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido % no existe', v_idpedido; END IF;
  IF v_estado_cuenta <> 'abierta' OR v_estado IN ('listo', 'entregado', 'pagado', 'cancelado') THEN
    RAISE EXCEPTION 'El pedido % ya no admite modificaciones', v_idpedido;
  END IF;
  IF TG_OP = 'DELETE' AND v_estado <> 'abierto' THEN RAISE EXCEPTION 'Después de confirmar el detalle debe anularse, no eliminarse'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.fk_idpedido IS DISTINCT FROM OLD.fk_idpedido THEN RAISE EXCEPTION 'No se puede mover un detalle a otro pedido'; END IF;
  IF TG_OP = 'UPDATE' AND v_estado <> 'abierto' AND NEW.fk_idproducto_menu IS DISTINCT FROM OLD.fk_idproducto_menu THEN
    RAISE EXCEPTION 'Después de confirmar debe anularse la línea y agregarse otra';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION validar_detalle_producto()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_precio_venta numeric(14,0); v_precio_compra numeric(14,0); v_es_vender boolean; v_usa_receta boolean;
BEGIN
  SELECT precio_venta, precio_compra, es_vender INTO v_precio_venta, v_precio_compra, v_es_vender
  FROM producto_menu WHERE idproducto_menu = NEW.fk_idproducto_menu;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto % no existe', NEW.fk_idproducto_menu; END IF;
  IF NOT v_es_vender AND (TG_OP = 'INSERT' OR NEW.cantidad > OLD.cantidad) THEN RAISE EXCEPTION 'El producto % no está habilitado para la venta', NEW.fk_idproducto_menu; END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.fk_idproducto_menu IS DISTINCT FROM OLD.fk_idproducto_menu) THEN
    NEW.precio_venta := v_precio_venta;
    NEW.precio_compra := v_precio_compra;
    SELECT EXISTS (SELECT 1 FROM receta WHERE fk_idproducto_menu = NEW.fk_idproducto_menu) INTO v_usa_receta;
    NEW.usa_receta_stock := v_usa_receta;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION anular_pedido(p_idpedido integer, p_idusuario integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pedido SET estado = 'cancelado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo
  WHERE idpedido = p_idpedido AND estado IN ('abierto', 'confirmado', 'en_preparacion', 'listo', 'entregado', 'pagado');
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no admite anulación'; END IF;
  PERFORM sincronizar_stock_pedido(p_idpedido, p_idusuario, p_anulado_por);
END;
$$;

CREATE OR REPLACE FUNCTION validar_devolucion_pago()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_pago pago%ROWTYPE; v_pedido pedido%ROWTYPE; v_caja integer; v_original integer;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Las devoluciones son inmutables'; END IF;
 SELECT * INTO v_pedido FROM pedido WHERE idpedido=NEW.fk_idpedido;
 SELECT * INTO v_pago FROM pago WHERE idpago=NEW.fk_idpago FOR UPDATE;
 IF NOT FOUND OR v_pago.estado <> 'aprobado' OR v_pedido.estado <> 'cancelado' OR
    v_pedido.fk_idcuenta <> v_pago.fk_idcuenta THEN RAISE EXCEPTION 'Pago incompatible con la anulación'; END IF;
 IF NEW.importe + COALESCE((SELECT SUM(importe) FROM devolucion_pago WHERE fk_idpago=NEW.fk_idpago),0) > v_pago.importe THEN
   RAISE EXCEPTION 'La devolución supera el importe disponible del pago';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER trg_devolucion_validar BEFORE INSERT OR UPDATE OR DELETE ON devolucion_pago
 FOR EACH ROW EXECUTE PROCEDURE validar_devolucion_pago();

CREATE OR REPLACE FUNCTION caja_devolucion_pago()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_caja integer; v_original caja_item%ROWTYPE;
BEGIN
 SELECT idcaja_gral INTO v_caja FROM caja_gral WHERE estado='abierta' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe una caja abierta para devolver dinero'; END IF;
 SELECT * INTO v_original FROM caja_item WHERE fk_idpago=NEW.fk_idpago AND NOT es_reversion;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe el movimiento original del pago'; END IF;
 INSERT INTO caja_item(fk_idcaja_gral,fk_idforma_pago,tipo_movimiento,descripcion,monto_pago,
   fk_idpago,es_reversion,fk_idcaja_item_origen,fk_iddevolucion_pago,creado_por)
 VALUES(v_caja,v_original.fk_idforma_pago,'egreso','Devolución pedido ' || NEW.fk_idpedido,
   NEW.importe,NEW.fk_idpago,true,v_original.idcaja_item,NEW.iddevolucion_pago,NEW.creado_por);
 RETURN NEW;
END;
$$;
CREATE TRIGGER trg_devolucion_caja AFTER INSERT ON devolucion_pago
 FOR EACH ROW EXECUTE PROCEDURE caja_devolucion_pago();

-- Comprobar el saldo final de cada transacción, también en anulaciones históricas.
CREATE OR REPLACE FUNCTION comprobar_saldo_web()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_id integer; v_total numeric; v_neto numeric; v_estado estado_cuenta;
BEGIN
 IF TG_TABLE_NAME='cuenta' THEN v_id:=NEW.idcuenta;
 ELSIF TG_TABLE_NAME='devolucion_pago' THEN SELECT fk_idcuenta INTO v_id FROM pago WHERE idpago=NEW.fk_idpago;
 ELSE v_id:=NEW.fk_idcuenta; END IF;
 SELECT total,estado INTO v_total,v_estado FROM cuenta WHERE idcuenta=v_id FOR UPDATE;
 v_neto:=cobrado_neto_cuenta(v_id);
 IF v_neto<0 OR v_neto>v_total OR (v_estado='cerrada' AND v_neto<>v_total) THEN
   RAISE EXCEPTION 'El saldo final requiere ajustar cobros y devoluciones';
 END IF;
 RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER trg_saldo_web_cuenta AFTER INSERT OR UPDATE ON cuenta
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE comprobar_saldo_web();
CREATE CONSTRAINT TRIGGER trg_saldo_web_pago AFTER INSERT OR UPDATE ON pago
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE comprobar_saldo_web();
CREATE CONSTRAINT TRIGGER trg_saldo_web_devolucion AFTER INSERT ON devolucion_pago
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE PROCEDURE comprobar_saldo_web();

