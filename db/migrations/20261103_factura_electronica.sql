-- Factura electrónica (SISFE / SIFEN): datos del restaurante, facturas y su detalle.
CREATE SEQUENCE IF NOT EXISTS factura_id_seq;
CREATE SEQUENCE IF NOT EXISTS factura_detalle_id_seq;

CREATE TABLE IF NOT EXISTS datos_restaurante (
  iddatos_restaurante integer PRIMARY KEY DEFAULT 1 CHECK (iddatos_restaurante = 1),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_modificado timestamp,
  modificado_por text,
  razon_social varchar(150) NOT NULL DEFAULT '',
  nombre_fantasia varchar(150) NOT NULL DEFAULT '',
  ruc varchar(30) NOT NULL DEFAULT '',
  timbrado varchar(20) NOT NULL DEFAULT '',
  direccion varchar(250) NOT NULL DEFAULT '',
  ciudad varchar(100) NOT NULL DEFAULT '',
  telefono varchar(40) NOT NULL DEFAULT '',
  email varchar(150) NOT NULL DEFAULT '',
  establecimiento varchar(3) NOT NULL DEFAULT '001' CHECK (establecimiento ~ '^[0-9]{3}$'),
  punto varchar(3) NOT NULL DEFAULT '001' CHECK (punto ~ '^[0-9]{3}$'),
  numero_actual integer NOT NULL DEFAULT 0 CHECK (numero_actual >= 0),
  sisfe_url varchar(250) NOT NULL DEFAULT '',
  sisfe_tenant varchar(100) NOT NULL DEFAULT '',
  sisfe_api_key text NOT NULL DEFAULT '',
  ambiente varchar(10) NOT NULL DEFAULT 'prueba' CHECK (ambiente IN ('prueba', 'produccion'))
);
INSERT INTO datos_restaurante (iddatos_restaurante) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS factura (
  idfactura integer PRIMARY KEY DEFAULT nextval('factura_id_seq'),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idpedido integer NOT NULL REFERENCES pedido(idpedido),
  fk_idcliente integer REFERENCES cliente(idcliente),
  cliente_ruc varchar(30),
  cliente_razon_social varchar(150) NOT NULL,
  cliente_direccion varchar(250),
  cliente_email varchar(150),
  cliente_celular varchar(40),
  contribuyente boolean NOT NULL DEFAULT false,
  tipo_contribuyente smallint CHECK (tipo_contribuyente IN (1, 2)),
  tipo_operacion smallint NOT NULL DEFAULT 2 CHECK (tipo_operacion IN (1, 2, 3, 4)),
  establecimiento varchar(3) NOT NULL,
  punto varchar(3) NOT NULL,
  numero integer NOT NULL CHECK (numero > 0),
  fecha_emision timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total numeric(14,0) NOT NULL CHECK (total >= 0),
  base_gravada10 numeric(14,0) NOT NULL DEFAULT 0 CHECK (base_gravada10 >= 0),
  total_iva10 numeric(14,0) NOT NULL DEFAULT 0 CHECK (total_iva10 >= 0),
  estado varchar(12) NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'borrador', 'enviado', 'aprobado', 'rechazado', 'cancelado', 'error')),
  lote_id integer,
  cdc varchar(44),
  respuesta_codigo varchar(10),
  respuesta_mensaje text,
  qr text,
  fecha_cancelado timestamp,
  cancelado_por text,
  motivo_cancelado text,
  CONSTRAINT factura_cancelacion_valida CHECK (
    (estado = 'cancelado' AND fecha_cancelado IS NOT NULL AND cancelado_por IS NOT NULL AND motivo_cancelado IS NOT NULL) OR
    (estado <> 'cancelado' AND fecha_cancelado IS NULL AND cancelado_por IS NULL AND motivo_cancelado IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS factura_un_pedido_activo ON factura (fk_idpedido) WHERE estado <> 'cancelado';
CREATE UNIQUE INDEX IF NOT EXISTS factura_numeracion_unica ON factura (establecimiento, punto, numero);
CREATE UNIQUE INDEX IF NOT EXISTS factura_cdc_unico ON factura (cdc) WHERE cdc IS NOT NULL;
CREATE INDEX IF NOT EXISTS factura_fecha_idx ON factura (fecha_emision DESC);

CREATE TABLE IF NOT EXISTS factura_detalle (
  idfactura_detalle integer PRIMARY KEY DEFAULT nextval('factura_detalle_id_seq'),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idfactura integer NOT NULL REFERENCES factura(idfactura) ON DELETE CASCADE,
  codigo varchar(50) NOT NULL,
  descripcion varchar(250) NOT NULL,
  unidad_medida smallint NOT NULL DEFAULT 77,
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  precio_unitario numeric(14,0) NOT NULL CHECK (precio_unitario >= 0),
  descuento numeric(14,0) NOT NULL DEFAULT 0 CHECK (descuento >= 0),
  iva_tipo smallint NOT NULL DEFAULT 1,
  iva_base smallint NOT NULL DEFAULT 100,
  iva smallint NOT NULL DEFAULT 10 CHECK (iva IN (0, 5, 10)),
  subtotal numeric(14,0) NOT NULL CHECK (subtotal >= 0)
);
CREATE INDEX IF NOT EXISTS factura_detalle_factura_idx ON factura_detalle (fk_idfactura);

INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Facturas', 'Acceso al formulario Facturas', 'FORM_FACTURAS', 'SISTEMA'),
  ('Datos de restaurante', 'Acceso a los datos de restaurante y conexión de facturación', 'FORM_DATOS_RESTAURANTE', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;

INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento IN ('FORM_FACTURAS', 'FORM_DATOS_RESTAURANTE')
WHERE r.rol IN ('admin', 'encargado')
ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
