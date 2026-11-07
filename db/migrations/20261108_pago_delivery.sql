-- Pagos a delivery: lo cobrado por delivery es del entregador. Al pagarle, la plata sale de la caja abierta
-- como un Gasto del tipo "Pago a delivery" (la caja, el arqueo y el Análisis de gastos ya lo descuentan).
-- Cada pago guarda qué pedidos incluye; un pedido no puede estar en dos pagos activos.
-- Compatible con PostgreSQL 9.5 e idempotente.
CREATE SEQUENCE IF NOT EXISTS pago_delivery_id_seq;
CREATE TABLE IF NOT EXISTS pago_delivery (
  idpago_delivery integer NOT NULL DEFAULT nextval('pago_delivery_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_identregador_delivery integer NOT NULL REFERENCES entregador_delivery(identregador_delivery),
  fecha_desde date NOT NULL,
  fecha_hasta date NOT NULL,
  cantidad_pedidos integer NOT NULL CHECK (cantidad_pedidos > 0),
  total numeric(14,0) NOT NULL CHECK (total > 0),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  fk_idgasto integer NOT NULL UNIQUE REFERENCES gasto(idgasto),
  estado varchar(10) NOT NULL DEFAULT 'pagado' CHECK (estado IN ('pagado', 'anulado')),
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT pago_delivery_rango_valido CHECK (fecha_desde <= fecha_hasta),
  CONSTRAINT pago_delivery_anulacion_valida CHECK (
    (estado = 'anulado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado = 'pagado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS pago_delivery_entregador_idx ON pago_delivery (fk_identregador_delivery, fecha_creado DESC);

CREATE TABLE IF NOT EXISTS pago_delivery_pedido (
  fk_idpago_delivery integer NOT NULL REFERENCES pago_delivery(idpago_delivery),
  fk_idpedido integer NOT NULL REFERENCES pedido(idpedido),
  monto_delivery numeric(14,0) NOT NULL CHECK (monto_delivery > 0),
  activo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (fk_idpago_delivery, fk_idpedido)
);
-- Un pedido solo puede estar en un pago activo (al anular el pago, sus pedidos quedan libres).
CREATE UNIQUE INDEX IF NOT EXISTS pago_delivery_pedido_unico ON pago_delivery_pedido (fk_idpedido) WHERE activo;

INSERT INTO gasto_tipo (nombre, orden, creado_por)
SELECT 'Pago a delivery', COALESCE((SELECT MAX(orden) FROM gasto_tipo), 0) + 1, 'SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM gasto_tipo WHERE lower(nombre) = 'pago a delivery');

-- Permite asignar o cambiar solo el entregador de un pedido delivery aunque su cuenta esté cerrada.
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
  -- Pagos a delivery: en un pedido delivery se puede asignar o cambiar solo el entregador (a uno activo),
  -- aunque la cuenta ya esté cerrada (pedido cobrado). Ningún otro dato puede cambiar.
  IF TG_OP = 'UPDATE' AND NEW.tipo_entrega = 'DELIVERY' AND NEW.estado <> 'cancelado' AND
     NEW.fk_identregador_delivery IS NOT NULL AND NEW.fk_identregador_delivery IS DISTINCT FROM OLD.fk_identregador_delivery AND
     (to_jsonb(NEW) - 'fk_identregador_delivery') = (to_jsonb(OLD) - 'fk_identregador_delivery') THEN
    IF NOT EXISTS (SELECT 1 FROM entregador_delivery WHERE identregador_delivery = NEW.fk_identregador_delivery AND activo) THEN
      RAISE EXCEPTION 'El entregador no existe o está inactivo';
    END IF;
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
    IF NEW.fk_identregador_delivery IS NOT NULL AND
       (TG_OP = 'INSERT' OR NEW.fk_identregador_delivery IS DISTINCT FROM OLD.fk_identregador_delivery) THEN
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
