-- Módulo RR.HH.: datos básicos y forma de pago del personal, vales con impacto en caja
-- y permisos de los formularios Personal y Vales (solo rol admin). Compatible con PostgreSQL 9.5.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='cargo') THEN
    ALTER TABLE personal ADD COLUMN cargo varchar(80);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='direccion') THEN
    ALTER TABLE personal ADD COLUMN direccion varchar(250);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='fecha_ingreso') THEN
    ALTER TABLE personal ADD COLUMN fecha_ingreso date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='tipo_pago') THEN
    ALTER TABLE personal ADD COLUMN tipo_pago varchar(10) NOT NULL DEFAULT 'MENSUAL';
    ALTER TABLE personal ADD CONSTRAINT personal_tipo_pago_valido CHECK (tipo_pago IN ('DIARIO','SEMANAL','QUINCENAL','MENSUAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='monto_pago') THEN
    ALTER TABLE personal ADD COLUMN monto_pago numeric(14,0) NOT NULL DEFAULT 0;
    ALTER TABLE personal ADD CONSTRAINT personal_monto_pago_valido CHECK (monto_pago >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='personal' AND column_name='observacion') THEN
    ALTER TABLE personal ADD COLUMN observacion varchar(500);
  END IF;
END $$;

-- limite_monto_vale = 0 significa "sin límite" (antes rechazaba cualquier vale).
CREATE OR REPLACE FUNCTION validar_vale_personal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_activo boolean; v_limite numeric(14,0); v_forma_activa boolean; v_es_egreso boolean;
BEGIN
  SELECT activo, limite_monto_vale INTO v_activo, v_limite
  FROM personal WHERE idpersonal = NEW.fk_idpersonal;
  IF NOT FOUND THEN RAISE EXCEPTION 'El personal % no existe', NEW.fk_idpersonal; END IF;
  IF TG_OP = 'INSERT' AND NOT v_activo THEN RAISE EXCEPTION 'El personal % está inactivo', NEW.fk_idpersonal; END IF;
  IF v_limite > 0 AND NEW.monto_vale > v_limite THEN
    RAISE EXCEPTION 'El monto del vale % supera el límite permitido de %', NEW.monto_vale, v_limite;
  END IF;
  SELECT activo, es_egreso INTO v_forma_activa, v_es_egreso FROM forma_pago WHERE idforma_pago = NEW.fk_idforma_pago;
  IF NOT FOUND OR (TG_OP = 'INSERT' AND NOT v_forma_activa) THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva'; END IF;
  IF NEW.estado = 'pagado' AND NOT v_es_egreso THEN RAISE EXCEPTION 'La forma de pago no admite egresos'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN ('pagado', 'anulado')) OR
    (OLD.estado = 'pagado' AND NEW.estado = 'anulado')
  ) THEN RAISE EXCEPTION 'Transición de vale inválida'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' AND
     (NEW.fk_idpersonal IS DISTINCT FROM OLD.fk_idpersonal OR NEW.fk_idforma_pago IS DISTINCT FROM OLD.fk_idforma_pago OR NEW.monto_vale IS DISTINCT FROM OLD.monto_vale) THEN
    RAISE EXCEPTION 'Un vale pagado no puede cambiar persona, forma ni importe';
  END IF;
  RETURN NEW;
END;
$$;

INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT v.nombre,v.descripcion,v.codigo,'SISTEMA'
FROM (VALUES ('Personal','Acceso al formulario Personal (RR.HH.)','FORM_PERSONAL'),
             ('Vales','Acceso al formulario Vales (RR.HH.)','FORM_VALES')) AS v(nombre,descripcion,codigo)
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento e WHERE e.codigo_evento=v.codigo);

INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento IN ('FORM_PERSONAL','FORM_VALES')
WHERE r.rol='admin'
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item i WHERE i.fk_idusuario_rol=r.idusuario_rol AND i.fk_idusuario_rol_evento=e.idusuario_rol_evento);
