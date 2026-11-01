\ir seed.sql

BEGIN;
DO $$
DECLARE
  v_cliente integer; v_mesa integer; v_cuenta integer; v_usuario integer;
  v_categoria integer; v_unidad_menu integer; v_grupo integer;
  v_unidad_kg integer; v_unidad_g integer; v_forma integer;
  v_producto integer; v_producto_directo integer; v_ingrediente integer;
  v_pedido integer; v_pedido_directo integer; v_pedido_delivery integer;
  v_pago integer; v_compra integer; v_proveedor integer; v_gasto integer; v_vale integer;
  v_caja integer; v_stock numeric; v_total numeric; v_conteos jsonb;
BEGIN
  SELECT idusuario INTO v_usuario FROM usuario WHERE login = 'admin';
  SELECT idmesa INTO v_mesa FROM mesa WHERE numero = 1;
  SELECT idcategoria_menu INTO v_categoria FROM categoria_menu WHERE nombre = 'Platos principales';
  SELECT idunidad_menu INTO v_unidad_menu FROM unidad_menu WHERE nombre = 'Porción';
  SELECT idgrupo_menu INTO v_grupo FROM grupo_menu WHERE nombre = 'Comida';
  SELECT idunidad_medida INTO v_unidad_kg FROM unidad_medida WHERE codigo = 'KG';
  SELECT idunidad_medida INTO v_unidad_g FROM unidad_medida WHERE codigo = 'G';
  SELECT idforma_pago INTO v_forma FROM forma_pago WHERE nombre = 'Efectivo';
  SELECT idproveedor INTO v_proveedor FROM proveedor WHERE nombre = 'Proveedor general';

  INSERT INTO cliente (nombre_completo, ruc, direccion, telefono, email, fk_idzona_cliente, creado_por)
  SELECT 'Cliente Integral', '80012345-5', 'Calle 123', '1111-2222', 'integral@test.local', idzona_cliente, 'PRUEBA'
  FROM zona_cliente WHERE codigo = 'Z001' RETURNING idcliente INTO v_cliente;

  v_caja := abrir_caja_gral(jsonb_build_object(v_forma::text, 10000), 'PRUEBA');
  BEGIN
    PERFORM abrir_caja_gral('{}'::jsonb, 'PRUEBA');
    RAISE EXCEPTION 'Se permitió una segunda caja abierta';
  EXCEPTION WHEN unique_violation THEN NULL; WHEN OTHERS THEN
    IF SQLERRM = 'Se permitió una segunda caja abierta' THEN RAISE; END IF;
  END;

  INSERT INTO ingrediente (nombre, fk_idunidad_medida, stock_actual, precio_compra, precio_venta, creado_por)
  VALUES ('Ingrediente integral', v_unidad_kg, 10, 40, 30, 'PRUEBA') RETURNING idingrediente INTO v_ingrediente;
  INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, es_descontar_stock, es_cocina, es_vender, creado_por)
  VALUES (v_categoria, v_unidad_menu, v_grupo, 'Plato integral', 100, 40, true, true, true, 'PRUEBA') RETURNING idproducto_menu INTO v_producto;
  INSERT INTO receta (fk_idproducto_menu, fk_idingrediente, fk_idunidad_medida, cantidad, creado_por)
  VALUES (v_producto, v_ingrediente, v_unidad_kg, 1, 'PRUEBA');

  v_cuenta := abrir_cuenta_mesa(v_mesa, v_cliente, 'PRUEBA');
  INSERT INTO pedido (fk_idmesa, fk_idcuenta, fk_idcliente, tipo_entrega, monto_descuento, monto_recargo, creado_por)
  VALUES (v_mesa, v_cuenta, v_cliente, 'COMER_ACA', 5, 10, 'PRUEBA') RETURNING idpedido INTO v_pedido;
  INSERT INTO detalle_pedido (fk_idpedido, fk_idproducto_menu, cantidad, precio_venta, precio_compra, creado_por)
  VALUES (v_pedido, v_producto, 2, 0, 0, 'PRUEBA');
  INSERT INTO detalle_pedido_ingrediente (fk_iddetalle_pedido, fk_idingrediente, tipo_modificacion, cantidad, precio_venta, creado_por)
  SELECT iddetalle_pedido, v_ingrediente, 'AGREGAR', 1, 0, 'PRUEBA' FROM detalle_pedido WHERE fk_idpedido = v_pedido;
  PERFORM confirmar_pedido(v_pedido, v_usuario, 'PRUEBA');
  IF (SELECT stock_actual FROM ingrediente WHERE idingrediente = v_ingrediente) <> 8 THEN RAISE EXCEPTION 'Consumo inicial incorrecto'; END IF;
  UPDATE detalle_pedido SET cantidad = 3 WHERE fk_idpedido = v_pedido;
  IF (SELECT stock_actual FROM ingrediente WHERE idingrediente = v_ingrediente) <> 7 THEN RAISE EXCEPTION 'El ajuste diferencial descontó incorrectamente'; END IF;
  UPDATE cuenta SET monto_descuento = 10, monto_recargo = 20 WHERE idcuenta = v_cuenta;
  SELECT total INTO v_total FROM cuenta WHERE idcuenta = v_cuenta;
  IF v_total <> 405 THEN RAISE EXCEPTION 'Total de cuenta incorrecto: %', v_total; END IF;
  BEGIN
    INSERT INTO pago (fk_idcuenta, fk_idforma_pago, importe, estado, creado_por) VALUES (v_cuenta, v_forma, 406, 'aprobado', 'PRUEBA');
    RAISE EXCEPTION 'Se permitió sobrepago';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'Se permitió sobrepago' THEN RAISE; END IF; END;
  INSERT INTO pago (fk_idcuenta, fk_idforma_pago, importe, estado, creado_por) VALUES (v_cuenta, v_forma, 100, 'aprobado', 'PRUEBA') RETURNING idpago INTO v_pago;
  INSERT INTO pago (fk_idcuenta, fk_idforma_pago, importe, estado, creado_por) VALUES (v_cuenta, v_forma, 305, 'aprobado', 'PRUEBA');
  UPDATE pedido SET estado = 'en_preparacion' WHERE idpedido = v_pedido;
  UPDATE pedido SET estado = 'listo' WHERE idpedido = v_pedido;
  UPDATE pedido SET estado = 'entregado' WHERE idpedido = v_pedido;
  PERFORM cerrar_cuenta_mesa(v_cuenta, 'PRUEBA');
  IF (SELECT estado FROM mesa WHERE idmesa = v_mesa) <> 'libre' THEN RAISE EXCEPTION 'La mesa no fue liberada'; END IF;

  INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, stock_actual, es_descontar_stock, es_cocina, es_vender, es_comprar, creado_por)
  VALUES (v_categoria, v_unidad_menu, v_grupo, 'Producto directo integral', 50, 20, 5, true, false, true, true, 'PRUEBA') RETURNING idproducto_menu INTO v_producto_directo;
  v_pedido_directo := crear_pedido_externo('BUSCAR', v_cliente, 'Retiro integral', 'PRUEBA');
  INSERT INTO detalle_pedido (fk_idpedido, fk_idproducto_menu, cantidad, precio_venta, precio_compra, creado_por)
  VALUES (v_pedido_directo, v_producto_directo, 2, 0, 0, 'PRUEBA');
  PERFORM confirmar_pedido(v_pedido_directo, v_usuario, 'PRUEBA');
  PERFORM sincronizar_stock_pedido(v_pedido_directo, v_usuario, 'PRUEBA');
  IF (SELECT stock_actual FROM producto_menu WHERE idproducto_menu = v_producto_directo) <> 3 THEN RAISE EXCEPTION 'El producto directo se descontó más de una vez'; END IF;
  UPDATE detalle_pedido SET cantidad = 1 WHERE fk_idpedido = v_pedido_directo;
  IF (SELECT stock_actual FROM producto_menu WHERE idproducto_menu = v_producto_directo) <> 4 THEN RAISE EXCEPTION 'No se devolvió la diferencia del producto'; END IF;
  PERFORM anular_pedido(v_pedido_directo, v_usuario, 'PRUEBA', 'Prueba de reversión');
  IF (SELECT stock_actual FROM producto_menu WHERE idproducto_menu = v_producto_directo) <> 5 THEN RAISE EXCEPTION 'La anulación no restauró el producto'; END IF;

  v_pedido_delivery := crear_pedido_externo('DELIVERY', v_cliente, 'Entregar en puerta', 'PRUEBA');
  IF NOT EXISTS (SELECT 1 FROM pedido WHERE idpedido = v_pedido_delivery AND direccion_entrega = 'Calle 123' AND telefono_entrega = '1111-2222' AND zona_codigo = 'Z001' AND monto_delivery = 1500) THEN
    RAISE EXCEPTION 'No se guardó la copia histórica de delivery';
  END IF;

  INSERT INTO compra (fk_idproveedor, fk_idusuario, fecha_compra, numero_nota, condicion, creado_por)
  VALUES (v_proveedor, v_usuario, CURRENT_TIMESTAMP, 'N-INT-1', 'Contado', 'PRUEBA') RETURNING idcompra INTO v_compra;
  INSERT INTO detalle_compra (fk_idcompra, fk_idingrediente, fk_idunidad_medida, cantidad, precio_compra, creado_por)
  VALUES (v_compra, v_ingrediente, v_unidad_kg, 1, 2, 'PRUEBA');
  INSERT INTO detalle_compra_producto (fk_idcompra, fk_idproducto_menu, cantidad, precio_compra, creado_por)
  VALUES (v_compra, v_producto_directo, 4, 10, 'PRUEBA');
  PERFORM registrar_compra_recibida(v_compra, 'PRUEBA');
  IF (SELECT total FROM compra WHERE idcompra = v_compra) <> 42 THEN RAISE EXCEPTION 'Total de compra incorrecto'; END IF;
  IF (SELECT cantidad_base FROM detalle_compra WHERE fk_idcompra = v_compra) <> 1 THEN RAISE EXCEPTION 'Cantidad base de compra incorrecta'; END IF;
  PERFORM pagar_compra(v_compra, v_forma, 'PRUEBA');
  PERFORM anular_compra(v_compra, 'PRUEBA', 'Compra anulada de prueba');

  INSERT INTO gasto (fk_idgasto_tipo, fk_idforma_pago, descripcion, total_gasto, creado_por)
  SELECT idgasto_tipo, v_forma, 'Gasto integral', 75, 'PRUEBA' FROM gasto_tipo WHERE nombre = 'Servicios' RETURNING idgasto INTO v_gasto;
  PERFORM pagar_gasto(v_gasto);
  PERFORM anular_gasto(v_gasto, 'PRUEBA', 'Gasto anulado de prueba');
  INSERT INTO vale (fk_idpersonal, fk_idforma_pago, descripcion, monto_vale, creado_por)
  SELECT idpersonal, v_forma, 'Vale integral', 100, 'PRUEBA' FROM personal WHERE documento = '30111222333' RETURNING idvale INTO v_vale;
  PERFORM pagar_vale(v_vale);

  IF (SELECT count(*) FROM caja_item WHERE fk_idcaja_gral = v_caja) <> 7 THEN RAISE EXCEPTION 'Cantidad de movimientos automáticos de caja incorrecta'; END IF;
  v_conteos := jsonb_build_object(v_forma::text, 10305);
  PERFORM cerrar_caja_gral(v_caja, v_conteos, 'PRUEBA');
  IF NOT EXISTS (SELECT 1 FROM caja_arqueo WHERE fk_idcaja_gral = v_caja AND fk_idforma_pago = v_forma AND monto_esperado = 10305 AND diferencia = 0) THEN
    RAISE EXCEPTION 'Arqueo por forma de pago incorrecto';
  END IF;
  BEGIN
    INSERT INTO gasto (fk_idgasto_tipo, fk_idforma_pago, descripcion, total_gasto, creado_por)
    SELECT idgasto_tipo, v_forma, 'Sin caja', 10, 'PRUEBA' FROM gasto_tipo WHERE nombre = 'Servicios' RETURNING idgasto INTO v_gasto;
    PERFORM pagar_gasto(v_gasto);
    RAISE EXCEPTION 'Se permitió pagar sin caja abierta';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'Se permitió pagar sin caja abierta' THEN RAISE; END IF; END;
  BEGIN
    DELETE FROM cuenta WHERE idcuenta = v_cuenta;
    RAISE EXCEPTION 'Se permitió borrar una cuenta';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM = 'Se permitió borrar una cuenta' THEN RAISE; END IF; END;
END;
$$;
ROLLBACK;
SELECT 'OK: revisión integral completada' AS resultado;

-- Pruebas completas de pedidos/API: node db/test-pedidos-web.js y node db/test-pedidos-http.js.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='pedido' AND column_name='version_web' AND data_type='integer') THEN
    RAISE EXCEPTION 'Falta el control de edición concurrente de pedidos';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='devolucion_pago' AND column_name='importe'
      AND numeric_precision=14 AND numeric_scale=0) THEN
    RAISE EXCEPTION 'Falta la devolución parcial con importe entero';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='caja_item' AND column_name='fk_iddevolucion_pago') THEN
    RAISE EXCEPTION 'Falta la relación entre caja y devoluciones';
  END IF;
END;
$$;
