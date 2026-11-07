-- Rentabilidad: costo del ingrediente al momento de la venta (agregados y recetas).
-- Las filas anteriores quedan con costo_unitario NULL: el análisis usa el precio actual y las marca como "estimado".
-- Compatible con PostgreSQL 9.5.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='detalle_pedido_ingrediente' AND column_name='costo_unitario') THEN
    ALTER TABLE detalle_pedido_ingrediente ADD COLUMN costo_unitario numeric(14,0) CHECK (costo_unitario IS NULL OR costo_unitario >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='detalle_pedido_receta' AND column_name='costo_unitario') THEN
    ALTER TABLE detalle_pedido_receta ADD COLUMN costo_unitario numeric(14,0) CHECK (costo_unitario IS NULL OR costo_unitario >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fijar_costo_ingrediente_venta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.costo_unitario IS NULL THEN
    SELECT precio_compra INTO NEW.costo_unitario FROM ingrediente WHERE idingrediente = NEW.fk_idingrediente;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_costo_detalle_pedido_ingrediente ON detalle_pedido_ingrediente;
CREATE TRIGGER trg_costo_detalle_pedido_ingrediente BEFORE INSERT ON detalle_pedido_ingrediente
  FOR EACH ROW EXECUTE PROCEDURE fijar_costo_ingrediente_venta();
DROP TRIGGER IF EXISTS trg_costo_detalle_pedido_receta ON detalle_pedido_receta;
CREATE TRIGGER trg_costo_detalle_pedido_receta BEFORE INSERT ON detalle_pedido_receta
  FOR EACH ROW EXECUTE PROCEDURE fijar_costo_ingrediente_venta();

-- Permiso del Análisis de rentabilidad: para los roles que ya ven el Análisis de pedidos.
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Análisis de rentabilidad','Acceso al análisis de rentabilidad por producto y categoría','FORM_KPI_RENTABILIDAD','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_KPI_RENTABILIDAD');
INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT DISTINCT i.fk_idusuario_rol,nuevo.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol_item i
JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.codigo_evento='FORM_KPI_PEDIDOS'
CROSS JOIN (SELECT idusuario_rol_evento FROM usuario_rol_evento WHERE codigo_evento='FORM_KPI_RENTABILIDAD') nuevo
WHERE i.activo
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item x WHERE x.fk_idusuario_rol=i.fk_idusuario_rol AND x.fk_idusuario_rol_evento=nuevo.idusuario_rol_evento);
