CREATE OR REPLACE FUNCTION abrir_caja_gral(p_saldos_iniciales jsonb DEFAULT '{}'::jsonb, p_creado_por text DEFAULT 'SISTEMA')
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_idcaja integer; v_par record; v_idforma integer; v_monto numeric(14,0); v_efectivo integer; v_cantidad integer;
BEGIN
  IF EXISTS (SELECT 1 FROM caja_gral WHERE estado = 'abierta') THEN RAISE EXCEPTION 'Ya existe una caja abierta'; END IF;
  SELECT count(*), min(idforma_pago) INTO v_cantidad, v_efectivo
  FROM forma_pago WHERE activo AND upper(btrim(nombre)) = 'EFECTIVO';
  IF v_cantidad <> 1 THEN RAISE EXCEPTION 'Debe existir una única forma de pago activa llamada EFECTIVO'; END IF;
  SELECT count(*) INTO v_cantidad FROM jsonb_each_text(COALESCE(p_saldos_iniciales, '{}'::jsonb));
  IF v_cantidad <> 1 OR NOT COALESCE(p_saldos_iniciales, '{}'::jsonb) ? v_efectivo::text THEN
    RAISE EXCEPTION 'La apertura de caja admite únicamente saldo inicial en EFECTIVO';
  END IF;
  INSERT INTO caja_gral (creado_por) VALUES (p_creado_por) RETURNING idcaja_gral INTO v_idcaja;
  FOR v_par IN SELECT * FROM jsonb_each_text(p_saldos_iniciales) LOOP
    v_idforma := v_par.key::integer;
    v_monto := v_par.value::numeric;
    IF v_monto < 0 THEN RAISE EXCEPTION 'El monto inicial no puede ser negativo'; END IF;
    INSERT INTO caja_arqueo (fk_idcaja_gral, fk_idforma_pago, monto_inicial, monto_esperado, creado_por)
    VALUES (v_idcaja, v_idforma, v_monto, v_monto, p_creado_por);
  END LOOP;
  RETURN v_idcaja;
END;
$$;

CREATE OR REPLACE FUNCTION cerrar_caja_gral(p_idcaja_gral integer, p_montos_contados jsonb, p_cerrado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_caja caja_gral%ROWTYPE; v_arqueo caja_arqueo%ROWTYPE; v_ingresos numeric(14,0); v_egresos numeric(14,0); v_contado numeric(14,0); v_esperado numeric(14,0);
BEGIN
  SELECT * INTO v_caja FROM caja_gral WHERE idcaja_gral = p_idcaja_gral FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La caja % no existe', p_idcaja_gral; END IF;
  IF v_caja.estado = 'cerrada' THEN RAISE EXCEPTION 'La caja % ya está cerrada', p_idcaja_gral; END IF;
  FOR v_arqueo IN SELECT * FROM caja_arqueo WHERE fk_idcaja_gral = p_idcaja_gral FOR UPDATE LOOP
    IF v_arqueo.monto_inicial = 0 AND NOT EXISTS (SELECT 1 FROM caja_item WHERE fk_idcaja_gral=p_idcaja_gral AND fk_idforma_pago=v_arqueo.fk_idforma_pago) THEN
      v_contado := 0;
    ELSIF NOT COALESCE(p_montos_contados, '{}'::jsonb) ? v_arqueo.fk_idforma_pago::text THEN
      RAISE EXCEPTION 'Falta monto contado para la forma de pago %', v_arqueo.fk_idforma_pago;
    ELSE
      v_contado := (p_montos_contados ->> v_arqueo.fk_idforma_pago::text)::numeric;
    END IF;
    IF v_contado < 0 THEN RAISE EXCEPTION 'El monto contado no puede ser negativo'; END IF;
    SELECT
      COALESCE(SUM(CASE WHEN tipo_movimiento = 'ingreso' THEN monto_pago + monto_compra + monto_gasto + monto_vale ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN tipo_movimiento = 'egreso' THEN monto_pago + monto_compra + monto_gasto + monto_vale ELSE 0 END), 0)
    INTO v_ingresos, v_egresos FROM caja_item
    WHERE fk_idcaja_gral = p_idcaja_gral AND fk_idforma_pago = v_arqueo.fk_idforma_pago;
    v_esperado := v_arqueo.monto_inicial + v_ingresos - v_egresos;
    UPDATE caja_arqueo SET total_ingresos = v_ingresos, total_egresos = v_egresos,
      monto_esperado = v_esperado, monto_contado = v_contado, diferencia = v_contado - v_esperado
    WHERE idcaja_arqueo = v_arqueo.idcaja_arqueo;
  END LOOP;
  UPDATE caja_gral SET estado = 'cerrada', fecha_cierre = CURRENT_TIMESTAMP, cerrado_por = p_cerrado_por
  WHERE idcaja_gral = p_idcaja_gral;
END;
$$;
