-- Insumos: catálogo igual al de ingredientes y lista de insumos (con cantidad) de cada producto del menú.
-- La lista del producto es informativa: no descuenta stock ni tiene precio de venta.
-- Compatible con PostgreSQL 9.5 e idempotente.
CREATE SEQUENCE IF NOT EXISTS insumo_id_seq;

CREATE TABLE IF NOT EXISTS insumo (
  idinsumo integer NOT NULL DEFAULT nextval('insumo_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(120) NOT NULL UNIQUE,
  fk_idunidad_medida integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  stock_actual numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0), stock_minimo numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  precio_compra numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_compra >= 0), precio_venta numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0), activo boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS producto_menu_insumo (
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu) ON DELETE CASCADE,
  fk_idinsumo integer NOT NULL REFERENCES insumo(idinsumo),
  cantidad numeric(14,3) NOT NULL CHECK (cantidad > 0),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  PRIMARY KEY (fk_idproducto_menu, fk_idinsumo)
);

INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Insumos', 'Acceso al formulario Insumos', 'FORM_INSUMOS', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;

-- Lo reciben los roles que ya tienen Ingredientes. Si después se le quita a un rol, repetir la migración no lo devuelve.
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT DISTINCT i.fk_idusuario_rol, nuevo.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol_item i
JOIN usuario_rol_evento origen ON origen.idusuario_rol_evento = i.fk_idusuario_rol_evento AND origen.codigo_evento = 'FORM_INGREDIENTES'
JOIN usuario_rol_evento nuevo ON nuevo.codigo_evento = 'FORM_INSUMOS'
WHERE i.activo
ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
