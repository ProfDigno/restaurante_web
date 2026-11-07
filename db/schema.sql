-- Restaurante Web - esquema PostgreSQL para mesas, cuentas y pedidos.
-- Todas las tablas usan: id..., fecha_creado y creado_por.

CREATE TYPE estado_mesa AS ENUM ('libre', 'ocupado');
CREATE TYPE estado_cuenta AS ENUM ('abierta', 'cerrada');
CREATE TYPE tipo_cuenta AS ENUM ('SALON', 'DELIVERY', 'BUSCAR');
CREATE TYPE tipo_entrega AS ENUM ('COMER_ACA', 'DELIVERY', 'BUSCAR');
CREATE TYPE estado_pedido AS ENUM ('abierto', 'confirmado', 'en_preparacion', 'listo', 'entregado', 'cancelado', 'pagado');
CREATE TYPE estado_detalle_pedido AS ENUM ('pendiente', 'en_preparacion', 'listo', 'entregado', 'cancelado');
CREATE TYPE estado_pago AS ENUM ('pendiente', 'aprobado', 'rechazado', 'anulado');
CREATE TYPE tipo_movimiento_stock AS ENUM ('compra', 'consumo', 'ajuste_entrada', 'ajuste_salida', 'devolucion');
CREATE TYPE estado_compra AS ENUM ('borrador', 'recibida', 'cancelada');
CREATE TYPE estado_pago_compra AS ENUM ('pendiente', 'pagada', 'anulada');
CREATE TYPE estado_gasto AS ENUM ('pendiente', 'pagado', 'anulado');
CREATE TYPE estado_vale AS ENUM ('pendiente', 'pagado', 'anulado');
CREATE TYPE estado_caja_gral AS ENUM ('abierta', 'cerrada');
CREATE TYPE tipo_movimiento_caja AS ENUM ('ingreso', 'egreso');
CREATE TYPE tipo_modificacion_ingrediente AS ENUM ('AGREGAR', 'QUITAR');

-- Compatibilidad con PostgreSQL 9.5: secuencias equivalentes a columnas identity.
CREATE SEQUENCE usuario_rol_id_seq;
CREATE SEQUENCE usuario_rol_evento_id_seq;
CREATE SEQUENCE usuario_rol_item_id_seq;
CREATE SEQUENCE usuario_id_seq;
CREATE SEQUENCE zona_cliente_id_seq;
CREATE SEQUENCE cliente_id_seq;
CREATE SEQUENCE ubicacion_mesa_id_seq;
CREATE SEQUENCE mesa_id_seq;
CREATE SEQUENCE cuenta_id_seq;
CREATE SEQUENCE categoria_menu_id_seq;
CREATE SEQUENCE unidad_menu_id_seq;
CREATE SEQUENCE grupo_menu_id_seq;
CREATE SEQUENCE unidad_medida_id_seq;
CREATE SEQUENCE unidad_conversion_id_seq;
CREATE SEQUENCE ingrediente_id_seq;
CREATE SEQUENCE producto_menu_id_seq;
CREATE SEQUENCE receta_id_seq;
CREATE SEQUENCE proveedor_id_seq;
CREATE SEQUENCE entregador_delivery_id_seq;
CREATE SEQUENCE pedido_id_seq;
CREATE SEQUENCE detalle_pedido_id_seq;
CREATE SEQUENCE detalle_pedido_receta_id_seq;
CREATE SEQUENCE detalle_pedido_ingrediente_id_seq;
CREATE SEQUENCE forma_pago_id_seq;
CREATE SEQUENCE pago_id_seq;
CREATE SEQUENCE compra_id_seq;
CREATE SEQUENCE detalle_compra_id_seq;
CREATE SEQUENCE detalle_compra_producto_id_seq;
CREATE SEQUENCE gasto_tipo_id_seq;
CREATE SEQUENCE gasto_id_seq;
CREATE SEQUENCE personal_id_seq;
CREATE SEQUENCE vale_id_seq;
CREATE SEQUENCE caja_gral_id_seq;
CREATE SEQUENCE caja_arqueo_id_seq;
CREATE SEQUENCE caja_item_id_seq;
CREATE SEQUENCE movimiento_stock_id_seq;
CREATE SEQUENCE movimiento_stock_producto_id_seq;

CREATE TABLE usuario_rol (
  idusuario_rol integer NOT NULL DEFAULT nextval('usuario_rol_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  rol varchar(80) NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario_rol_evento (
  idusuario_rol_evento integer NOT NULL DEFAULT nextval('usuario_rol_evento_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(150) NOT NULL,
  descripcion varchar(500),
  codigo_evento varchar(120) NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE usuario_rol_item (
  idusuario_rol_item integer NOT NULL DEFAULT nextval('usuario_rol_item_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idusuario_rol integer NOT NULL REFERENCES usuario_rol(idusuario_rol) ON DELETE CASCADE,
  fk_idusuario_rol_evento integer NOT NULL REFERENCES usuario_rol_evento(idusuario_rol_evento) ON DELETE CASCADE,
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT usuario_rol_item_unico UNIQUE (fk_idusuario_rol, fk_idusuario_rol_evento)
);

CREATE INDEX usuario_rol_rol_idx ON usuario_rol (rol);
CREATE INDEX usuario_rol_evento_codigo_idx ON usuario_rol_evento (codigo_evento);
CREATE INDEX usuario_rol_item_evento_idx ON usuario_rol_item (fk_idusuario_rol_evento);

CREATE TABLE usuario (
  idusuario integer NOT NULL DEFAULT nextval('usuario_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  login varchar(50) NOT NULL UNIQUE, password_hash varchar(255) NOT NULL, nombre varchar(120) NOT NULL,
  activo boolean NOT NULL DEFAULT true, fk_idusuario_rol integer REFERENCES usuario_rol(idusuario_rol) ON DELETE SET NULL
);
CREATE INDEX usuario_rol_idx ON usuario (fk_idusuario_rol);

CREATE TABLE zona_cliente (
  idzona_cliente integer NOT NULL DEFAULT nextval('zona_cliente_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  codigo varchar(30) NOT NULL UNIQUE,
  nombre varchar(100) NOT NULL UNIQUE,
  precio_delivery numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_delivery >= 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE cliente (
  idcliente integer NOT NULL DEFAULT nextval('cliente_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre_completo varchar(120) NOT NULL, razon_social varchar(150), ruc varchar(30) UNIQUE CHECK (btrim(ruc) <> ''),
  direccion varchar(250), telefono varchar(40) CHECK (btrim(telefono) <> ''), email varchar(255), notas text,
  activo boolean NOT NULL DEFAULT true,
  es_ocacional boolean NOT NULL DEFAULT false,
  fk_idzona_cliente integer REFERENCES zona_cliente(idzona_cliente)
);
CREATE UNIQUE INDEX cliente_ruc_normalizado_unico ON cliente (lower(btrim(ruc)));
CREATE UNIQUE INDEX cliente_telefono_normalizado_unico ON cliente (btrim(telefono));
CREATE UNIQUE INDEX cliente_un_ocacional ON cliente (es_ocacional) WHERE es_ocacional;

CREATE TABLE ubicacion_mesa (
  idubicacion_mesa integer NOT NULL DEFAULT nextval('ubicacion_mesa_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX ubicacion_mesa_nombre_normalizado_unico ON ubicacion_mesa (lower(btrim(nombre)));
CREATE INDEX ubicacion_mesa_orden_idx ON ubicacion_mesa (orden, nombre, idubicacion_mesa);

CREATE TABLE mesa (
  idmesa integer NOT NULL DEFAULT nextval('mesa_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  numero smallint NOT NULL UNIQUE, capacidad smallint NOT NULL CHECK (capacidad > 0),
  fk_idubicacion_mesa integer NOT NULL REFERENCES ubicacion_mesa(idubicacion_mesa),
  estado estado_mesa NOT NULL DEFAULT 'libre', activa boolean NOT NULL DEFAULT true
);
CREATE INDEX mesa_ubicacion_mesa_idx ON mesa (fk_idubicacion_mesa);

CREATE TABLE cuenta (
  idcuenta integer NOT NULL DEFAULT nextval('cuenta_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idmesa integer REFERENCES mesa(idmesa), fk_idcliente integer REFERENCES cliente(idcliente),
  tipo tipo_cuenta NOT NULL DEFAULT 'SALON',
  estado estado_cuenta NOT NULL DEFAULT 'abierta', total numeric(14,0) NOT NULL DEFAULT 0 CHECK (total >= 0),
  monto_descuento numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_descuento >= 0),
  motivo_descuento text,
  monto_recargo numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_recargo >= 0),
  motivo_recargo text,
  fecha_apertura timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, fecha_cierre timestamp,
  cerrado_por text,
  CONSTRAINT cuenta_cierre_valido CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_apertura),
  CONSTRAINT cuenta_tipo_mesa_valido CHECK (
    (tipo = 'SALON' AND fk_idmesa IS NOT NULL) OR
    (tipo IN ('DELIVERY', 'BUSCAR') AND fk_idmesa IS NULL)
  )
);
CREATE UNIQUE INDEX cuenta_una_abierta_por_mesa ON cuenta (fk_idmesa) WHERE estado = 'abierta' AND fk_idmesa IS NOT NULL;

CREATE TABLE categoria_menu (
  idcategoria_menu integer NOT NULL DEFAULT nextval('categoria_menu_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL UNIQUE, descripcion text, imagen_url text, orden smallint NOT NULL DEFAULT 0, activa boolean NOT NULL DEFAULT true
);

CREATE TABLE unidad_menu (
  idunidad_menu integer NOT NULL DEFAULT nextval('unidad_menu_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL UNIQUE,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE grupo_menu (
  idgrupo_menu integer NOT NULL DEFAULT nextval('grupo_menu_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL UNIQUE,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE unidad_medida (
  idunidad_medida integer NOT NULL DEFAULT nextval('unidad_medida_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  codigo varchar(20) NOT NULL UNIQUE,
  nombre varchar(80) NOT NULL UNIQUE,
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE unidad_conversion (
  idunidad_conversion integer NOT NULL DEFAULT nextval('unidad_conversion_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idunidad_origen integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  fk_idunidad_destino integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  factor numeric(14,0) NOT NULL CHECK (factor > 0),
  activo boolean NOT NULL DEFAULT true,
  CONSTRAINT unidad_conversion_distinta CHECK (fk_idunidad_origen <> fk_idunidad_destino),
  CONSTRAINT unidad_conversion_unica UNIQUE (fk_idunidad_origen, fk_idunidad_destino)
);

CREATE TABLE producto_menu (
  idproducto_menu integer NOT NULL DEFAULT nextval('producto_menu_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcategoria_menu integer NOT NULL REFERENCES categoria_menu(idcategoria_menu),
  fk_idunidad_menu integer NOT NULL REFERENCES unidad_menu(idunidad_menu),
  fk_idgrupo_menu integer NOT NULL REFERENCES grupo_menu(idgrupo_menu),
  nombre varchar(120) NOT NULL, descripcion text,
  precio_venta numeric(14,0) NOT NULL CHECK (precio_venta >= 0),
  precio_compra numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_compra >= 0),
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  stock_actual numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0),
  stock_minimo numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  activo boolean NOT NULL DEFAULT true,
  es_descontar_stock boolean NOT NULL DEFAULT false,
  es_cocina boolean NOT NULL DEFAULT true,
  es_vender boolean NOT NULL DEFAULT true,
  es_comprar boolean NOT NULL DEFAULT false
);

CREATE TABLE ingrediente (
  idingrediente integer NOT NULL DEFAULT nextval('ingrediente_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(120) NOT NULL UNIQUE,
  fk_idunidad_medida integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  stock_actual numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_actual >= 0), stock_minimo numeric(14,0) NOT NULL DEFAULT 0 CHECK (stock_minimo >= 0),
  precio_compra numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_compra >= 0), precio_venta numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0), activo boolean NOT NULL DEFAULT true
);

CREATE TABLE receta (
  idreceta integer NOT NULL DEFAULT nextval('receta_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu) ON DELETE CASCADE,
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  fk_idunidad_medida integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  CONSTRAINT receta_producto_ingrediente_unico UNIQUE (fk_idproducto_menu, fk_idingrediente)
);

-- Lista informativa del producto; no participa en el descuento de stock.
CREATE TABLE producto_menu_ingrediente (
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu) ON DELETE CASCADE,
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  PRIMARY KEY (fk_idproducto_menu, fk_idingrediente)
);

CREATE TABLE proveedor (
  idproveedor integer NOT NULL DEFAULT nextval('proveedor_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(140) NOT NULL UNIQUE, ruc varchar(30) UNIQUE, direccion varchar(250), telefono varchar(40), contacto varchar(120), email varchar(255), activo boolean NOT NULL DEFAULT true
);

-- Cargos del personal (RR.HH.): catálogo sin duplicados (único sin distinguir mayúsculas, sin espacios sobrantes).
CREATE SEQUENCE IF NOT EXISTS cargo_personal_id_seq;
CREATE TABLE cargo_personal (
  idcargo_personal integer NOT NULL DEFAULT nextval('cargo_personal_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL CONSTRAINT cargo_personal_nombre_limpio CHECK (nombre <> '' AND nombre = btrim(nombre) AND nombre !~ '\s{2,}'),
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX cargo_personal_nombre_unico ON cargo_personal (lower(nombre));

CREATE TABLE personal (
  idpersonal integer NOT NULL DEFAULT nextval('personal_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre_completo varchar(120) NOT NULL,
  documento varchar(40) UNIQUE,
  telefono varchar(40),
  limite_monto_vale numeric(14,0) NOT NULL DEFAULT 0 CHECK (limite_monto_vale >= 0),
  activo boolean NOT NULL DEFAULT true,
  fk_idcargo_personal integer REFERENCES cargo_personal(idcargo_personal),
  direccion varchar(250),
  fecha_ingreso date,
  tipo_pago varchar(10) NOT NULL DEFAULT 'MENSUAL' CONSTRAINT personal_tipo_pago_valido CHECK (tipo_pago IN ('DIARIO','SEMANAL','QUINCENAL','MENSUAL')),
  monto_pago numeric(14,0) NOT NULL DEFAULT 0 CONSTRAINT personal_monto_pago_valido CHECK (monto_pago >= 0),
  observacion varchar(500)
);

CREATE TABLE gasto_tipo (
  idgasto_tipo integer NOT NULL DEFAULT nextval('gasto_tipo_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(100) NOT NULL UNIQUE,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE TABLE forma_pago (
  idforma_pago integer NOT NULL DEFAULT nextval('forma_pago_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL UNIQUE,
  es_ingreso boolean NOT NULL DEFAULT true,
  es_egreso boolean NOT NULL DEFAULT false,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true,
  es_default boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX forma_pago_unica_default ON forma_pago (es_default) WHERE es_default;

CREATE TABLE entregador_delivery (
  identregador_delivery integer NOT NULL DEFAULT nextval('entregador_delivery_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre_completo varchar(120) NOT NULL,
  telefono varchar(40), activo boolean NOT NULL DEFAULT true
);

CREATE TABLE pedido (
  idpedido integer NOT NULL DEFAULT nextval('pedido_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idmesa integer REFERENCES mesa(idmesa), fk_idcuenta integer NOT NULL REFERENCES cuenta(idcuenta), fk_idcliente integer REFERENCES cliente(idcliente),
  fk_identregador_delivery integer REFERENCES entregador_delivery(identregador_delivery),
  tipo_entrega tipo_entrega NOT NULL DEFAULT 'COMER_ACA', estado estado_pedido NOT NULL DEFAULT 'abierto',
  monto_delivery numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_delivery >= 0),
  monto_descuento numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_descuento >= 0),
  motivo_descuento text,
  monto_recargo numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_recargo >= 0),
  motivo_recargo text,
  monto_total numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_total >= 0), observacion text,
  direccion_entrega varchar(250), telefono_entrega varchar(40), zona_codigo varchar(30), zona_nombre varchar(100),
  fecha_confirmado timestamp, confirmado_por text,
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT pedido_tipo_entrega_valido CHECK (
    (tipo_entrega = 'COMER_ACA' AND fk_idmesa IS NOT NULL AND fk_idcuenta IS NOT NULL AND monto_delivery = 0 AND fk_identregador_delivery IS NULL) OR
    (tipo_entrega = 'DELIVERY' AND fk_idmesa IS NULL AND fk_idcuenta IS NOT NULL) OR
    (tipo_entrega = 'BUSCAR' AND fk_idmesa IS NULL AND fk_idcuenta IS NOT NULL AND monto_delivery = 0 AND fk_identregador_delivery IS NULL)
  ),
  CONSTRAINT pedido_confirmacion_valida CHECK ((fecha_confirmado IS NULL) = (confirmado_por IS NULL)),
  CONSTRAINT pedido_anulacion_valida CHECK (
    (estado = 'cancelado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'cancelado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);
CREATE UNIQUE INDEX pedido_unico_por_cuenta_externa ON pedido (fk_idcuenta) WHERE tipo_entrega IN ('DELIVERY', 'BUSCAR');

CREATE TABLE detalle_pedido (
  iddetalle_pedido integer NOT NULL DEFAULT nextval('detalle_pedido_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idpedido integer NOT NULL REFERENCES pedido(idpedido) ON DELETE CASCADE,
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu), cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  precio_venta numeric(14,0) NOT NULL CHECK (precio_venta >= 0), precio_compra numeric(14,0) NOT NULL CHECK (precio_compra >= 0),
  estado estado_detalle_pedido NOT NULL DEFAULT 'pendiente', observaciones text,
  usa_receta_stock boolean,
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT detalle_pedido_anulacion_valida CHECK (
    (estado = 'cancelado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'cancelado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);

CREATE TABLE detalle_pedido_receta (
  iddetalle_pedido_receta integer NOT NULL DEFAULT nextval('detalle_pedido_receta_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_iddetalle_pedido integer NOT NULL REFERENCES detalle_pedido(iddetalle_pedido),
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  cantidad_base numeric(14,0) NOT NULL CHECK (cantidad_base > 0),
  CONSTRAINT detalle_pedido_receta_unica UNIQUE (fk_iddetalle_pedido, fk_idingrediente)
);

CREATE TABLE detalle_pedido_ingrediente (
  iddetalle_pedido_ingrediente integer NOT NULL DEFAULT nextval('detalle_pedido_ingrediente_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_iddetalle_pedido integer NOT NULL REFERENCES detalle_pedido(iddetalle_pedido) ON DELETE CASCADE,
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  tipo_modificacion tipo_modificacion_ingrediente NOT NULL,
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  precio_venta numeric(14,0) NOT NULL DEFAULT 0 CHECK (precio_venta >= 0),
  observacion text,
  activo boolean NOT NULL DEFAULT true,
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT detalle_pedido_ingrediente_unico UNIQUE (fk_iddetalle_pedido, fk_idingrediente, tipo_modificacion),
  CONSTRAINT ingrediente_quitado_sin_cargo CHECK (tipo_modificacion <> 'QUITAR' OR precio_venta = 0),
  CONSTRAINT detalle_ingrediente_anulacion_valida CHECK (
    (activo = false AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (activo = true AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);

CREATE TABLE pago (
  idpago integer NOT NULL DEFAULT nextval('pago_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcuenta integer NOT NULL REFERENCES cuenta(idcuenta), fk_idpedido integer REFERENCES pedido(idpedido),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago), importe numeric(14,0) NOT NULL CHECK (importe > 0),
  estado estado_pago NOT NULL DEFAULT 'pendiente', referencia varchar(120), pagado_at timestamp,
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT pago_anulacion_valida CHECK (
    (estado = 'anulado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'anulado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);

CREATE TABLE compra (
  idcompra integer NOT NULL DEFAULT nextval('compra_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idproveedor integer NOT NULL REFERENCES proveedor(idproveedor),
  fk_idusuario integer NOT NULL REFERENCES usuario(idusuario),
  fk_idforma_pago integer REFERENCES forma_pago(idforma_pago) ON DELETE RESTRICT,
  estado estado_compra NOT NULL DEFAULT 'borrador',
  estado_pago estado_pago_compra NOT NULL DEFAULT 'pendiente',
  fecha_compra timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  numero_nota varchar(80),
  condicion varchar(40),
  total numeric(14,0) NOT NULL DEFAULT 0 CHECK (total >= 0),
  importe_pagado numeric(14,0) NOT NULL DEFAULT 0 CHECK (importe_pagado >= 0),
  fecha_pago timestamp,
  pagado_por text,
  observacion text,
  fecha_anulado timestamp,
  anulado_por text,
  motivo_anulado text,
  CONSTRAINT compra_anulacion_valida CHECK (
    (estado = 'cancelada' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'cancelada' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  ),
  CONSTRAINT compra_pago_valido CHECK (
    (estado_pago = 'pendiente' AND importe_pagado = 0 AND fecha_pago IS NULL AND pagado_por IS NULL) OR
    (estado_pago IN ('pagada', 'anulada') AND fk_idforma_pago IS NOT NULL AND importe_pagado = total AND fecha_pago IS NOT NULL AND pagado_por IS NOT NULL)
  )
);

CREATE TABLE gasto (
  idgasto integer NOT NULL DEFAULT nextval('gasto_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idgasto_tipo integer NOT NULL REFERENCES gasto_tipo(idgasto_tipo),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  fecha_gasto timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  descripcion varchar(500) NOT NULL,
  total_gasto numeric(14,0) NOT NULL CHECK (total_gasto > 0),
  estado estado_gasto NOT NULL DEFAULT 'pendiente',
  fecha_anulado timestamp,
  anulado_por text,
  motivo_anulado text,
  CONSTRAINT gasto_anulacion_valida CHECK (
    (estado = 'anulado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'anulado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);

CREATE TABLE vale (
  idvale integer NOT NULL DEFAULT nextval('vale_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idpersonal integer NOT NULL REFERENCES personal(idpersonal),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  fecha_vale timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  descripcion varchar(500) NOT NULL,
  estado estado_vale NOT NULL DEFAULT 'pendiente',
  monto_vale numeric(14,0) NOT NULL CHECK (monto_vale > 0),
  fecha_anulado timestamp,
  anulado_por text,
  motivo_anulado text,
  CONSTRAINT vale_anulacion_valida CHECK (
    (estado = 'anulado' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado <> 'anulado' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);

CREATE TABLE caja_gral (
  idcaja_gral integer NOT NULL DEFAULT nextval('caja_gral_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_apertura timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cierre timestamp,
  cerrado_por text,
  estado estado_caja_gral NOT NULL DEFAULT 'abierta',
  CONSTRAINT caja_gral_fechas_validas CHECK (fecha_cierre IS NULL OR fecha_cierre >= fecha_apertura),
  CONSTRAINT caja_gral_cierre_valido CHECK (
    (estado = 'cerrada' AND fecha_cierre IS NOT NULL AND cerrado_por IS NOT NULL) OR
    (estado = 'abierta' AND fecha_cierre IS NULL AND cerrado_por IS NULL)
  )
);

CREATE TABLE caja_arqueo (
  idcaja_arqueo integer NOT NULL DEFAULT nextval('caja_arqueo_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcaja_gral integer NOT NULL REFERENCES caja_gral(idcaja_gral),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  monto_inicial numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_inicial >= 0),
  total_ingresos numeric(14,0) NOT NULL DEFAULT 0 CHECK (total_ingresos >= 0),
  total_egresos numeric(14,0) NOT NULL DEFAULT 0 CHECK (total_egresos >= 0),
  monto_esperado numeric(14,0) NOT NULL DEFAULT 0,
  monto_contado numeric(14,0) CHECK (monto_contado IS NULL OR monto_contado >= 0),
  diferencia numeric(14,0),
  CONSTRAINT caja_arqueo_forma_unica UNIQUE (fk_idcaja_gral, fk_idforma_pago)
);

CREATE TABLE caja_item (
  idcaja_item integer NOT NULL DEFAULT nextval('caja_item_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcaja_gral integer NOT NULL REFERENCES caja_gral(idcaja_gral),
  fk_idforma_pago integer NOT NULL REFERENCES forma_pago(idforma_pago),
  tipo_movimiento tipo_movimiento_caja NOT NULL,
  descripcion text NOT NULL DEFAULT 'Movimiento de caja',
  monto_pago numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_pago >= 0),
  monto_compra numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_compra >= 0),
  monto_gasto numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_gasto >= 0),
  monto_vale numeric(14,0) NOT NULL DEFAULT 0 CHECK (monto_vale >= 0),
  fk_idpago integer REFERENCES pago(idpago),
  fk_idcompra integer REFERENCES compra(idcompra),
  fk_idgasto integer REFERENCES gasto(idgasto),
  fk_idvale integer REFERENCES vale(idvale),
  es_reversion boolean NOT NULL DEFAULT false,
  fk_idcaja_item_origen integer REFERENCES caja_item(idcaja_item),
  CONSTRAINT caja_item_unico_origen CHECK (
    (CASE WHEN fk_idpago IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idcompra IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idgasto IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idvale IS NOT NULL THEN 1 ELSE 0 END) = 1
  ),
  CONSTRAINT caja_item_unico_monto CHECK (
    (CASE WHEN fk_idpago IS NOT NULL AND monto_pago > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idcompra IS NOT NULL AND monto_compra > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idgasto IS NOT NULL AND monto_gasto > 0 THEN 1 ELSE 0 END) +
    (CASE WHEN fk_idvale IS NOT NULL AND monto_vale > 0 THEN 1 ELSE 0 END) = 1 AND
    (fk_idpago IS NULL OR (monto_compra = 0 AND monto_gasto = 0 AND monto_vale = 0)) AND
    (fk_idcompra IS NULL OR (monto_pago = 0 AND monto_gasto = 0 AND monto_vale = 0)) AND
    (fk_idgasto IS NULL OR (monto_pago = 0 AND monto_compra = 0 AND monto_vale = 0)) AND
    (fk_idvale IS NULL OR (monto_pago = 0 AND monto_compra = 0 AND monto_gasto = 0))
  ),
  CONSTRAINT caja_item_reversion_valida CHECK (
    (es_reversion = true AND fk_idcaja_item_origen IS NOT NULL) OR
    (es_reversion = false AND fk_idcaja_item_origen IS NULL)
  )
);

CREATE UNIQUE INDEX caja_gral_una_abierta ON caja_gral (estado) WHERE estado = 'abierta';

CREATE TABLE detalle_compra (
  iddetalle_compra integer NOT NULL DEFAULT nextval('detalle_compra_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcompra integer NOT NULL REFERENCES compra(idcompra) ON DELETE CASCADE,
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  fk_idunidad_medida integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  cantidad_base numeric(14,0),
  precio_compra numeric(14,0) NOT NULL CHECK (precio_compra >= 0),
  CONSTRAINT detalle_compra_ingrediente_unico UNIQUE (fk_idcompra, fk_idingrediente, fk_idunidad_medida)
);

CREATE TABLE detalle_compra_producto (
  iddetalle_compra_producto integer NOT NULL DEFAULT nextval('detalle_compra_producto_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idcompra integer NOT NULL REFERENCES compra(idcompra) ON DELETE CASCADE,
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu),
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  precio_compra numeric(14,0) NOT NULL CHECK (precio_compra >= 0),
  CONSTRAINT detalle_compra_producto_unico UNIQUE (fk_idcompra, fk_idproducto_menu)
);

CREATE TABLE movimiento_stock (
  idmovimiento_stock integer NOT NULL DEFAULT nextval('movimiento_stock_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente), fk_idusuario integer REFERENCES usuario(idusuario), fk_idcompra integer REFERENCES compra(idcompra), fk_idpedido integer REFERENCES pedido(idpedido),
  fk_idunidad_medida integer NOT NULL REFERENCES unidad_medida(idunidad_medida),
  tipo tipo_movimiento_stock NOT NULL, cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0), cantidad_origen numeric(14,0), costo_unitario numeric(14,0) CHECK (costo_unitario IS NULL OR costo_unitario >= 0), motivo text,
  CONSTRAINT movimiento_origen_valido CHECK (
    (tipo = 'compra' AND fk_idcompra IS NOT NULL AND fk_idpedido IS NULL) OR (tipo = 'consumo' AND fk_idpedido IS NOT NULL AND fk_idcompra IS NULL) OR
    (tipo = 'devolucion' AND fk_idpedido IS NOT NULL AND fk_idcompra IS NULL) OR
    (tipo IN ('ajuste_entrada', 'ajuste_salida') AND fk_idpedido IS NULL)
  )
);

CREATE TABLE movimiento_stock_producto (
  idmovimiento_stock_producto integer NOT NULL DEFAULT nextval('movimiento_stock_producto_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu),
  fk_idusuario integer REFERENCES usuario(idusuario),
  fk_idcompra integer REFERENCES compra(idcompra),
  fk_idpedido integer REFERENCES pedido(idpedido),
  tipo tipo_movimiento_stock NOT NULL,
  cantidad numeric(14,0) NOT NULL CHECK (cantidad > 0),
  costo_unitario numeric(14,0) CHECK (costo_unitario IS NULL OR costo_unitario >= 0),
  motivo text,
  CONSTRAINT movimiento_producto_origen_valido CHECK (
    (tipo = 'compra' AND fk_idcompra IS NOT NULL AND fk_idpedido IS NULL) OR
    (tipo IN ('consumo', 'devolucion') AND fk_idpedido IS NOT NULL AND fk_idcompra IS NULL) OR
    (tipo IN ('ajuste_entrada', 'ajuste_salida') AND fk_idpedido IS NULL)
  )
);

CREATE OR REPLACE VIEW vista_detalle_pedido AS
SELECT
  dp.fk_idpedido AS idpedido,
  dp.iddetalle_pedido,
  'PRODUCTO'::text AS tipo_linea,
  pm.nombre::text AS descripcion,
  dp.cantidad,
  dp.precio_venta AS precio,
  1::smallint AS orden_linea,
  NULL::integer AS iddetalle_pedido_ingrediente
FROM detalle_pedido dp
JOIN producto_menu pm ON pm.idproducto_menu = dp.fk_idproducto_menu
WHERE dp.estado <> 'cancelado'
UNION ALL
SELECT
  dp.fk_idpedido AS idpedido,
  dp.iddetalle_pedido,
  dpi.tipo_modificacion::text AS tipo_linea,
  CASE dpi.tipo_modificacion
    WHEN 'AGREGAR' THEN '(Agre) ' || i.nombre
    WHEN 'QUITAR' THEN '(Sin) ' || i.nombre
  END::text AS descripcion,
  dpi.cantidad,
  CASE WHEN dpi.tipo_modificacion = 'QUITAR' THEN 0::numeric(14,0) ELSE dpi.precio_venta END AS precio,
  2::smallint AS orden_linea,
  dpi.iddetalle_pedido_ingrediente
FROM detalle_pedido_ingrediente dpi
JOIN detalle_pedido dp ON dp.iddetalle_pedido = dpi.fk_iddetalle_pedido
JOIN ingrediente i ON i.idingrediente = dpi.fk_idingrediente
WHERE dp.estado <> 'cancelado' AND dpi.activo;

CREATE INDEX idx_cuenta_mesa ON cuenta (fk_idmesa);
CREATE INDEX idx_pedido_cuenta ON pedido (fk_idcuenta);
CREATE INDEX idx_pedido_estado ON pedido (estado, fecha_creado);
CREATE INDEX idx_pedido_entrega ON pedido (tipo_entrega, estado);
CREATE INDEX idx_detalle_pedido_pedido ON detalle_pedido (fk_idpedido);
CREATE INDEX idx_detalle_pedido_ingrediente_detalle ON detalle_pedido_ingrediente (fk_iddetalle_pedido);
CREATE INDEX idx_detalle_pedido_ingrediente_ingrediente ON detalle_pedido_ingrediente (fk_idingrediente);
CREATE INDEX idx_detalle_pedido_receta_detalle ON detalle_pedido_receta (fk_iddetalle_pedido);
CREATE INDEX idx_pago_cuenta ON pago (fk_idcuenta);
CREATE UNIQUE INDEX pago_anticipado_pedido_unico ON pago (fk_idpedido) WHERE fk_idpedido IS NOT NULL;
CREATE INDEX idx_pago_forma_pago ON pago (fk_idforma_pago);
CREATE INDEX idx_forma_pago_orden ON forma_pago (orden);
CREATE INDEX idx_compra_forma_pago ON compra (fk_idforma_pago);
CREATE INDEX idx_gasto_tipo ON gasto (fk_idgasto_tipo);
CREATE INDEX idx_gasto_forma_pago ON gasto (fk_idforma_pago);
CREATE INDEX idx_gasto_estado ON gasto (estado, fecha_gasto);
CREATE INDEX idx_vale_personal ON vale (fk_idpersonal);
CREATE INDEX idx_vale_forma_pago ON vale (fk_idforma_pago);
CREATE INDEX idx_vale_estado ON vale (estado);
CREATE INDEX idx_vale_fecha ON vale (fecha_vale);
CREATE INDEX idx_caja_item_caja ON caja_item (fk_idcaja_gral);
CREATE INDEX idx_caja_item_forma_pago ON caja_item (fk_idforma_pago);
CREATE INDEX idx_caja_item_tipo ON caja_item (tipo_movimiento);
CREATE INDEX idx_caja_arqueo_caja ON caja_arqueo (fk_idcaja_gral);
CREATE UNIQUE INDEX caja_item_pago_unico ON caja_item (fk_idpago) WHERE fk_idpago IS NOT NULL AND es_reversion = false;
CREATE UNIQUE INDEX caja_item_compra_unica ON caja_item (fk_idcompra) WHERE fk_idcompra IS NOT NULL AND es_reversion = false;
CREATE UNIQUE INDEX caja_item_gasto_unico ON caja_item (fk_idgasto) WHERE fk_idgasto IS NOT NULL AND es_reversion = false;
CREATE UNIQUE INDEX caja_item_vale_unico ON caja_item (fk_idvale) WHERE fk_idvale IS NOT NULL AND es_reversion = false;
CREATE UNIQUE INDEX caja_item_reversion_unica ON caja_item (fk_idcaja_item_origen) WHERE fk_idcaja_item_origen IS NOT NULL;
CREATE INDEX idx_movimiento_stock_ingrediente ON movimiento_stock (fk_idingrediente, fecha_creado);
CREATE INDEX idx_movimiento_stock_producto ON movimiento_stock_producto (fk_idproducto_menu, fecha_creado);
CREATE INDEX idx_detalle_compra_producto_compra ON detalle_compra_producto (fk_idcompra);
CREATE INDEX idx_cliente_zona ON cliente (fk_idzona_cliente);
CREATE INDEX idx_producto_menu_categoria_orden ON producto_menu (fk_idcategoria_menu, orden);
CREATE INDEX idx_producto_menu_unidad ON producto_menu (fk_idunidad_menu);
CREATE INDEX idx_producto_menu_grupo ON producto_menu (fk_idgrupo_menu);
CREATE INDEX idx_unidad_menu_orden ON unidad_menu (orden);
CREATE INDEX idx_grupo_menu_orden ON grupo_menu (orden);
CREATE INDEX idx_unidad_conversion_origen ON unidad_conversion (fk_idunidad_origen, fk_idunidad_destino);

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
CREATE TRIGGER trg_validar_caja_item
BEFORE INSERT OR UPDATE ON caja_item
FOR EACH ROW EXECUTE PROCEDURE validar_caja_item();

CREATE OR REPLACE FUNCTION registrar_movimiento_caja(
  p_origen text, p_idorigen integer, p_fk_idforma_pago integer, p_monto numeric(14,0),
  p_descripcion text, p_creado_por text, p_es_reversion boolean DEFAULT false
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_idcaja integer; v_tipo tipo_movimiento_caja; v_idoriginal integer; v_iditem integer;
BEGIN
  SELECT idcaja_gral INTO v_idcaja FROM caja_gral WHERE estado = 'abierta' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe una caja abierta'; END IF;
  v_tipo := CASE WHEN p_origen = 'pago' THEN 'ingreso'::tipo_movimiento_caja ELSE 'egreso'::tipo_movimiento_caja END;
  IF p_es_reversion THEN
    SELECT idcaja_item INTO v_idoriginal FROM caja_item
    WHERE es_reversion = false AND
      ((p_origen = 'pago' AND fk_idpago = p_idorigen) OR
       (p_origen = 'compra' AND fk_idcompra = p_idorigen) OR
       (p_origen = 'gasto' AND fk_idgasto = p_idorigen) OR
       (p_origen = 'vale' AND fk_idvale = p_idorigen));
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe movimiento original de caja para % %', p_origen, p_idorigen; END IF;
    v_tipo := CASE WHEN v_tipo = 'ingreso' THEN 'egreso'::tipo_movimiento_caja ELSE 'ingreso'::tipo_movimiento_caja END;
  END IF;
  IF p_origen = 'pago' THEN
    INSERT INTO caja_item (fk_idcaja_gral, fk_idforma_pago, tipo_movimiento, descripcion, monto_pago, fk_idpago, es_reversion, fk_idcaja_item_origen, creado_por)
    VALUES (v_idcaja, p_fk_idforma_pago, v_tipo, p_descripcion, p_monto, p_idorigen, p_es_reversion, v_idoriginal, p_creado_por)
    RETURNING idcaja_item INTO v_iditem;
  ELSIF p_origen = 'compra' THEN
    INSERT INTO caja_item (fk_idcaja_gral, fk_idforma_pago, tipo_movimiento, descripcion, monto_compra, fk_idcompra, es_reversion, fk_idcaja_item_origen, creado_por)
    VALUES (v_idcaja, p_fk_idforma_pago, v_tipo, p_descripcion, p_monto, p_idorigen, p_es_reversion, v_idoriginal, p_creado_por)
    RETURNING idcaja_item INTO v_iditem;
  ELSIF p_origen = 'gasto' THEN
    INSERT INTO caja_item (fk_idcaja_gral, fk_idforma_pago, tipo_movimiento, descripcion, monto_gasto, fk_idgasto, es_reversion, fk_idcaja_item_origen, creado_por)
    VALUES (v_idcaja, p_fk_idforma_pago, v_tipo, p_descripcion, p_monto, p_idorigen, p_es_reversion, v_idoriginal, p_creado_por)
    RETURNING idcaja_item INTO v_iditem;
  ELSIF p_origen = 'vale' THEN
    INSERT INTO caja_item (fk_idcaja_gral, fk_idforma_pago, tipo_movimiento, descripcion, monto_vale, fk_idvale, es_reversion, fk_idcaja_item_origen, creado_por)
    VALUES (v_idcaja, p_fk_idforma_pago, v_tipo, p_descripcion, p_monto, p_idorigen, p_es_reversion, v_idoriginal, p_creado_por)
    RETURNING idcaja_item INTO v_iditem;
  ELSE
    RAISE EXCEPTION 'Origen de caja no válido: %', p_origen;
  END IF;
  RETURN v_iditem;
END;
$$;

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
  FOR v_par IN SELECT * FROM jsonb_each_text(COALESCE(p_saldos_iniciales, '{}'::jsonb)) LOOP
    v_idforma := v_par.key::integer;
    v_monto := v_par.value::numeric;
    IF v_monto < 0 THEN RAISE EXCEPTION 'El monto inicial no puede ser negativo'; END IF;
    IF NOT EXISTS (SELECT 1 FROM forma_pago WHERE idforma_pago = v_idforma AND activo) THEN RAISE EXCEPTION 'Forma de pago inválida o inactiva: %', v_idforma; END IF;
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

CREATE OR REPLACE FUNCTION validar_vale_personal()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_activo boolean; v_limite numeric(14,0); v_forma_activa boolean; v_es_egreso boolean;
BEGIN
  SELECT activo, limite_monto_vale INTO v_activo, v_limite
  FROM personal WHERE idpersonal = NEW.fk_idpersonal;
  IF NOT FOUND THEN RAISE EXCEPTION 'El personal % no existe', NEW.fk_idpersonal; END IF;
  IF TG_OP = 'INSERT' AND NOT v_activo THEN RAISE EXCEPTION 'El personal % está inactivo', NEW.fk_idpersonal; END IF;
  -- limite_monto_vale = 0 significa "sin límite".
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
CREATE TRIGGER trg_validar_vale_personal
BEFORE INSERT OR UPDATE ON vale
FOR EACH ROW EXECUTE PROCEDURE validar_vale_personal();

CREATE OR REPLACE FUNCTION convertir_cantidad(p_cantidad numeric(14,0), p_unidad_origen integer, p_unidad_destino integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_factor numeric(14,0);
BEGIN
  IF p_cantidad <= 0 THEN RAISE EXCEPTION 'La cantidad debe ser mayor que cero'; END IF;
  IF p_unidad_origen = p_unidad_destino THEN RETURN p_cantidad; END IF;
  SELECT factor INTO v_factor FROM unidad_conversion
  WHERE fk_idunidad_origen = p_unidad_origen AND fk_idunidad_destino = p_unidad_destino AND activo;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe conversión activa entre las unidades % y %', p_unidad_origen, p_unidad_destino; END IF;
  IF p_cantidad * v_factor <> trunc(p_cantidad * v_factor) THEN RAISE EXCEPTION 'La conversión produce una cantidad decimal y no está permitida'; END IF;
  RETURN (p_cantidad * v_factor)::numeric(14,0);
END;
$$;

CREATE OR REPLACE FUNCTION validar_detalle_producto()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_precio_venta numeric(14,0); v_precio_compra numeric(14,0); v_es_vender boolean; v_usa_receta boolean;
BEGIN
  SELECT precio_venta, precio_compra, es_vender INTO v_precio_venta, v_precio_compra, v_es_vender
  FROM producto_menu WHERE idproducto_menu = NEW.fk_idproducto_menu;
  IF NOT FOUND THEN RAISE EXCEPTION 'El producto % no existe', NEW.fk_idproducto_menu; END IF;
  IF NOT v_es_vender THEN RAISE EXCEPTION 'El producto % no está habilitado para la venta', NEW.fk_idproducto_menu; END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.fk_idproducto_menu IS DISTINCT FROM OLD.fk_idproducto_menu) THEN
    NEW.precio_venta := v_precio_venta;
    NEW.precio_compra := v_precio_compra;
    SELECT EXISTS (SELECT 1 FROM receta WHERE fk_idproducto_menu = NEW.fk_idproducto_menu) INTO v_usa_receta;
    NEW.usa_receta_stock := v_usa_receta;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validar_detalle_producto BEFORE INSERT OR UPDATE ON detalle_pedido
FOR EACH ROW EXECUTE PROCEDURE validar_detalle_producto();

CREATE OR REPLACE FUNCTION validar_edicion_detalle_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_idpedido integer; v_estado estado_pedido; v_estado_cuenta estado_cuenta;
BEGIN
  v_idpedido := COALESCE(NEW.fk_idpedido, OLD.fk_idpedido);
  SELECT p.estado, c.estado INTO v_estado, v_estado_cuenta
  FROM pedido p JOIN cuenta c ON c.idcuenta = p.fk_idcuenta WHERE p.idpedido = v_idpedido;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido % no existe', v_idpedido; END IF;
  IF v_estado_cuenta <> 'abierta' OR v_estado IN ('entregado', 'pagado', 'cancelado') THEN
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
CREATE TRIGGER trg_edicion_detalle_pedido
BEFORE INSERT OR UPDATE OR DELETE ON detalle_pedido
FOR EACH ROW EXECUTE PROCEDURE validar_edicion_detalle_pedido();

CREATE OR REPLACE FUNCTION validar_detalle_ingrediente()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_precio_venta numeric(14,0); v_estado estado_pedido; v_estado_cuenta estado_cuenta; v_iddetalle integer;
BEGIN
  v_iddetalle := COALESCE(NEW.fk_iddetalle_pedido, OLD.fk_iddetalle_pedido);
  SELECT p.estado, c.estado INTO v_estado, v_estado_cuenta
  FROM detalle_pedido dp JOIN pedido p ON p.idpedido = dp.fk_idpedido JOIN cuenta c ON c.idcuenta = p.fk_idcuenta
  WHERE dp.iddetalle_pedido = v_iddetalle;
  IF NOT FOUND THEN RAISE EXCEPTION 'El detalle de pedido % no existe', v_iddetalle; END IF;
  IF v_estado_cuenta <> 'abierta' OR v_estado IN ('entregado', 'pagado', 'cancelado') THEN RAISE EXCEPTION 'El pedido ya no admite personalizaciones'; END IF;
  IF TG_OP = 'DELETE' THEN
    IF v_estado <> 'abierto' THEN RAISE EXCEPTION 'Después de confirmar la personalización debe anularse, no eliminarse'; END IF;
    RETURN OLD;
  END IF;
  SELECT precio_venta INTO v_precio_venta
  FROM ingrediente WHERE idingrediente = NEW.fk_idingrediente;
  IF NOT FOUND THEN RAISE EXCEPTION 'El ingrediente % no existe', NEW.fk_idingrediente; END IF;
  IF NEW.tipo_modificacion = 'QUITAR' THEN
    IF NEW.precio_venta <> 0 THEN RAISE EXCEPTION 'Un ingrediente quitado debe tener precio cero'; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.precio_venta := v_precio_venta;
  ELSIF NEW.fk_idingrediente IS DISTINCT FROM OLD.fk_idingrediente OR NEW.tipo_modificacion IS DISTINCT FROM OLD.tipo_modificacion THEN
    NEW.precio_venta := v_precio_venta;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validar_detalle_ingrediente
BEFORE INSERT OR UPDATE ON detalle_pedido_ingrediente
FOR EACH ROW EXECUTE PROCEDURE validar_detalle_ingrediente();

CREATE OR REPLACE FUNCTION recalcular_monto_pedido(p_idpedido integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_total numeric(14,0);
BEGIN
  SELECT (
    COALESCE((SELECT SUM(cantidad * precio_venta) FROM detalle_pedido WHERE fk_idpedido = p_idpedido AND estado <> 'cancelado'), 0) +
    COALESCE((SELECT SUM(dp.cantidad * dpi.precio_venta)
              FROM detalle_pedido_ingrediente dpi
              JOIN detalle_pedido dp ON dp.iddetalle_pedido = dpi.fk_iddetalle_pedido
              WHERE dp.fk_idpedido = p_idpedido AND dp.estado <> 'cancelado' AND dpi.activo AND dpi.tipo_modificacion = 'AGREGAR'), 0) +
    COALESCE(p.monto_delivery, 0) + COALESCE(p.monto_recargo, 0) - COALESCE(p.monto_descuento, 0)
  )::numeric(14,0) INTO v_total FROM pedido p WHERE p.idpedido = p_idpedido;
  IF v_total < 0 THEN RAISE EXCEPTION 'El descuento no puede superar el importe del pedido'; END IF;
  RETURN COALESCE(v_total, 0);
END;
$$;

CREATE OR REPLACE FUNCTION actualizar_monto_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_idpedido integer;
BEGIN
  v_idpedido := COALESCE(NEW.fk_idpedido, OLD.fk_idpedido);
  UPDATE pedido SET monto_total = recalcular_monto_pedido(v_idpedido) WHERE idpedido = v_idpedido;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_detalle_monto_pedido AFTER INSERT OR UPDATE OR DELETE ON detalle_pedido
FOR EACH ROW EXECUTE PROCEDURE actualizar_monto_pedido();

CREATE OR REPLACE FUNCTION actualizar_monto_por_ingrediente()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_iddetalle integer; v_idpedido integer;
BEGIN
  v_iddetalle := COALESCE(NEW.fk_iddetalle_pedido, OLD.fk_iddetalle_pedido);
  SELECT fk_idpedido INTO v_idpedido FROM detalle_pedido WHERE iddetalle_pedido = v_iddetalle;
  IF v_idpedido IS NOT NULL THEN
    UPDATE pedido SET monto_total = recalcular_monto_pedido(v_idpedido) WHERE idpedido = v_idpedido;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_detalle_pedido_ingrediente_monto
AFTER INSERT OR UPDATE OR DELETE ON detalle_pedido_ingrediente
FOR EACH ROW EXECUTE PROCEDURE actualizar_monto_por_ingrediente();

CREATE OR REPLACE FUNCTION actualizar_monto_delivery()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pedido SET monto_total = recalcular_monto_pedido(NEW.idpedido) WHERE idpedido = NEW.idpedido;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pedido_monto_delivery AFTER INSERT OR UPDATE OF monto_delivery, monto_descuento, monto_recargo ON pedido
FOR EACH ROW EXECUTE PROCEDURE actualizar_monto_delivery();

CREATE OR REPLACE FUNCTION validar_pedido_entrega()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_precio_delivery numeric(14,0); v_tipo_cuenta tipo_cuenta; v_estado_cuenta estado_cuenta;
  v_mesa_cuenta integer; v_cliente_cuenta integer; v_direccion varchar(250); v_telefono varchar(40);
  v_zona_codigo varchar(30); v_zona_nombre varchar(100); v_entregador_activo boolean;
BEGIN
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
CREATE TRIGGER trg_validar_pedido_entrega BEFORE INSERT OR UPDATE ON pedido
FOR EACH ROW EXECUTE PROCEDURE validar_pedido_entrega();

CREATE OR REPLACE FUNCTION validar_transicion_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'abierto' AND NEW.estado IN ('confirmado', 'cancelado')) OR
      (OLD.estado = 'confirmado' AND NEW.estado IN ('en_preparacion', 'cancelado')) OR
      (OLD.estado = 'en_preparacion' AND NEW.estado IN ('listo', 'cancelado')) OR
      (OLD.estado = 'listo' AND NEW.estado IN ('entregado', 'pagado', 'cancelado')) OR
      (OLD.estado = 'entregado' AND NEW.estado = 'pagado')
    ) THEN RAISE EXCEPTION 'Transición de pedido inválida: % a %', OLD.estado, NEW.estado; END IF;
  END IF;
  IF NEW.estado = 'confirmado' AND (NEW.fecha_confirmado IS NULL OR NEW.confirmado_por IS NULL) THEN
    RAISE EXCEPTION 'La confirmación requiere fecha y usuario';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_transicion_pedido BEFORE UPDATE OF estado ON pedido
FOR EACH ROW EXECUTE PROCEDURE validar_transicion_pedido();

CREATE OR REPLACE FUNCTION abrir_cuenta_mesa(p_fk_idmesa integer, p_fk_idcliente integer DEFAULT NULL, p_creado_por text DEFAULT 'SISTEMA')
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_idcuenta integer;
BEGIN
  PERFORM 1 FROM mesa WHERE idmesa = p_fk_idmesa AND activa = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La mesa % no existe o está inactiva', p_fk_idmesa; END IF;
  IF EXISTS (SELECT 1 FROM cuenta WHERE fk_idmesa = p_fk_idmesa AND estado = 'abierta') THEN RAISE EXCEPTION 'La mesa % ya está ocupada', p_fk_idmesa; END IF;
  INSERT INTO cuenta (fk_idmesa, fk_idcliente, tipo, creado_por) VALUES (p_fk_idmesa, p_fk_idcliente, 'SALON', p_creado_por) RETURNING idcuenta INTO v_idcuenta;
  UPDATE mesa SET estado = 'ocupado' WHERE idmesa = p_fk_idmesa;
  RETURN v_idcuenta;
END;
$$;

CREATE OR REPLACE FUNCTION crear_pedido_externo(
  p_tipo_entrega tipo_entrega, p_fk_idcliente integer DEFAULT NULL, p_observacion text DEFAULT NULL, p_creado_por text DEFAULT 'SISTEMA'
)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_idcuenta integer; v_idpedido integer; v_tipo_cuenta tipo_cuenta;
BEGIN
  IF p_tipo_entrega NOT IN ('DELIVERY', 'BUSCAR') THEN RAISE EXCEPTION 'Solo se permiten pedidos DELIVERY o BUSCAR'; END IF;
  IF p_tipo_entrega = 'DELIVERY' AND p_fk_idcliente IS NULL THEN RAISE EXCEPTION 'DELIVERY requiere cliente'; END IF;
  v_tipo_cuenta := p_tipo_entrega::text::tipo_cuenta;
  INSERT INTO cuenta (fk_idcliente, tipo, creado_por) VALUES (p_fk_idcliente, v_tipo_cuenta, p_creado_por) RETURNING idcuenta INTO v_idcuenta;
  INSERT INTO pedido (fk_idcuenta, fk_idcliente, tipo_entrega, observacion, creado_por)
  VALUES (v_idcuenta, p_fk_idcliente, p_tipo_entrega, p_observacion, p_creado_por) RETURNING idpedido INTO v_idpedido;
  RETURN v_idpedido;
END;
$$;

CREATE OR REPLACE FUNCTION calcular_total_cuenta(p_idcuenta integer)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE v_total numeric(14,0);
BEGIN
  SELECT COALESCE(SUM(CASE WHEN p.estado <> 'cancelado' THEN p.monto_total ELSE 0 END), 0) + c.monto_recargo - c.monto_descuento
  INTO v_total FROM cuenta c LEFT JOIN pedido p ON p.fk_idcuenta = c.idcuenta
  WHERE c.idcuenta = p_idcuenta GROUP BY c.idcuenta;
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta % no existe', p_idcuenta; END IF;
  IF v_total < 0 THEN RAISE EXCEPTION 'El descuento no puede superar el total de la cuenta'; END IF;
  RETURN v_total::numeric(14,0);
END;
$$;

CREATE OR REPLACE FUNCTION actualizar_total_cuenta(p_idcuenta integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE cuenta SET total = calcular_total_cuenta(p_idcuenta) WHERE idcuenta = p_idcuenta;
END;
$$;

CREATE OR REPLACE FUNCTION trg_actualizar_total_cuenta()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN PERFORM actualizar_total_cuenta(NEW.fk_idcuenta); END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.fk_idcuenta IS DISTINCT FROM NEW.fk_idcuenta) THEN PERFORM actualizar_total_cuenta(OLD.fk_idcuenta); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pedido_total_cuenta AFTER INSERT OR UPDATE OF monto_total, estado, fk_idcuenta OR DELETE ON pedido
FOR EACH ROW EXECUTE PROCEDURE trg_actualizar_total_cuenta();

CREATE OR REPLACE FUNCTION trg_actualizar_total_cuenta_ajuste()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.total := calcular_total_cuenta(NEW.idcuenta) - OLD.monto_recargo + OLD.monto_descuento + NEW.monto_recargo - NEW.monto_descuento;
  IF NEW.total < 0 THEN RAISE EXCEPTION 'El descuento no puede superar el total de la cuenta'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_cuenta_ajustes BEFORE UPDATE OF monto_descuento, monto_recargo ON cuenta
FOR EACH ROW EXECUTE PROCEDURE trg_actualizar_total_cuenta_ajuste();

CREATE OR REPLACE FUNCTION cerrar_cuenta_mesa(p_idcuenta integer, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_cuenta cuenta%ROWTYPE; v_total numeric(14,0); v_pagado numeric(14,0);
BEGIN
  SELECT * INTO v_cuenta FROM cuenta WHERE idcuenta = p_idcuenta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta % no existe', p_idcuenta; END IF;
  IF v_cuenta.estado = 'cerrada' THEN RAISE EXCEPTION 'La cuenta % ya está cerrada', p_idcuenta; END IF;
  v_total := calcular_total_cuenta(p_idcuenta);
  SELECT COALESCE(SUM(importe), 0) INTO v_pagado FROM pago WHERE fk_idcuenta = p_idcuenta AND estado = 'aprobado';
  IF v_pagado <> v_total THEN RAISE EXCEPTION 'La cuenta requiere pago exacto: total %, pagado %', v_total, v_pagado; END IF;
  IF EXISTS (SELECT 1 FROM pedido WHERE fk_idcuenta = p_idcuenta AND estado NOT IN ('entregado', 'pagado', 'cancelado')) THEN RAISE EXCEPTION 'Todos los pedidos deben estar entregados o cancelados'; END IF;
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
  IF NEW.estado = 'aprobado' THEN
    SELECT COALESCE(SUM(importe), 0) INTO v_pagado FROM pago
    WHERE fk_idcuenta = NEW.fk_idcuenta AND estado = 'aprobado' AND idpago <> COALESCE(NEW.idpago, 0);
    IF v_pagado + NEW.importe > v_total THEN RAISE EXCEPTION 'El pago supera el saldo pendiente de la cuenta'; END IF;
    IF NEW.pagado_at IS NULL THEN NEW.pagado_at = CURRENT_TIMESTAMP; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pago_estado BEFORE INSERT OR UPDATE ON pago FOR EACH ROW EXECUTE PROCEDURE actualizar_estado_pago();

CREATE OR REPLACE FUNCTION validar_gasto_financiero()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_activo boolean; v_egreso boolean;
BEGIN
  SELECT activo, es_egreso INTO v_activo, v_egreso FROM forma_pago WHERE idforma_pago = NEW.fk_idforma_pago;
  IF NOT FOUND OR NOT v_activo THEN RAISE EXCEPTION 'La forma de pago no existe o está inactiva'; END IF;
  IF NEW.estado = 'pagado' AND NOT v_egreso THEN RAISE EXCEPTION 'La forma de pago no admite egresos'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado = 'pendiente' AND NEW.estado IN ('pagado', 'anulado')) OR
    (OLD.estado = 'pagado' AND NEW.estado = 'anulado')
  ) THEN RAISE EXCEPTION 'Transición financiera inválida'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.estado = 'pagado' AND
     (NEW.fk_idforma_pago IS DISTINCT FROM OLD.fk_idforma_pago OR NEW.total_gasto IS DISTINCT FROM OLD.total_gasto) THEN
    RAISE EXCEPTION 'Un gasto pagado no puede cambiar forma ni importe';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validar_gasto BEFORE INSERT OR UPDATE ON gasto FOR EACH ROW EXECUTE PROCEDURE validar_gasto_financiero();

CREATE OR REPLACE FUNCTION registrar_origen_caja_automatico()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_aprobar boolean := false; v_revertir boolean := false; v_usuario text;
BEGIN
  IF TG_TABLE_NAME = 'pago' THEN
    v_aprobar := NEW.estado = 'aprobado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'aprobado');
    v_revertir := TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado = 'aprobado';
    v_usuario := COALESCE(NEW.anulado_por, NEW.creado_por);
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('pago', NEW.idpago, NEW.fk_idforma_pago, NEW.importe, 'Cobro de cuenta ' || NEW.fk_idcuenta, NEW.creado_por, false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('pago', NEW.idpago, NEW.fk_idforma_pago, NEW.importe, 'Reversión de cobro ' || NEW.idpago, v_usuario, true); END IF;
  ELSIF TG_TABLE_NAME = 'compra' THEN
    v_aprobar := NEW.estado_pago = 'pagada' AND (TG_OP = 'INSERT' OR OLD.estado_pago <> 'pagada');
    v_revertir := TG_OP = 'UPDATE' AND NEW.estado_pago = 'anulada' AND OLD.estado_pago = 'pagada';
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('compra', NEW.idcompra, NEW.fk_idforma_pago, NEW.importe_pagado, 'Pago de compra ' || NEW.idcompra, NEW.pagado_por, false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('compra', NEW.idcompra, NEW.fk_idforma_pago, NEW.importe_pagado, 'Reversión de compra ' || NEW.idcompra, NEW.anulado_por, true); END IF;
  ELSIF TG_TABLE_NAME = 'gasto' THEN
    v_aprobar := NEW.estado = 'pagado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagado');
    v_revertir := TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado = 'pagado';
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('gasto', NEW.idgasto, NEW.fk_idforma_pago, NEW.total_gasto, NEW.descripcion, NEW.creado_por, false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('gasto', NEW.idgasto, NEW.fk_idforma_pago, NEW.total_gasto, 'Reversión: ' || NEW.descripcion, NEW.anulado_por, true); END IF;
  ELSIF TG_TABLE_NAME = 'vale' THEN
    v_aprobar := NEW.estado = 'pagado' AND (TG_OP = 'INSERT' OR OLD.estado <> 'pagado');
    v_revertir := TG_OP = 'UPDATE' AND NEW.estado = 'anulado' AND OLD.estado = 'pagado';
    IF v_aprobar THEN PERFORM registrar_movimiento_caja('vale', NEW.idvale, NEW.fk_idforma_pago, NEW.monto_vale, NEW.descripcion, NEW.creado_por, false); END IF;
    IF v_revertir THEN PERFORM registrar_movimiento_caja('vale', NEW.idvale, NEW.fk_idforma_pago, NEW.monto_vale, 'Reversión: ' || NEW.descripcion, NEW.anulado_por, true); END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pago_caja AFTER INSERT OR UPDATE OF estado ON pago FOR EACH ROW EXECUTE PROCEDURE registrar_origen_caja_automatico();
CREATE TRIGGER trg_compra_caja AFTER INSERT OR UPDATE OF estado_pago ON compra FOR EACH ROW EXECUTE PROCEDURE registrar_origen_caja_automatico();
CREATE TRIGGER trg_gasto_caja AFTER INSERT OR UPDATE OF estado ON gasto FOR EACH ROW EXECUTE PROCEDURE registrar_origen_caja_automatico();
CREATE TRIGGER trg_vale_caja AFTER INSERT OR UPDATE OF estado ON vale FOR EACH ROW EXECUTE PROCEDURE registrar_origen_caja_automatico();

CREATE OR REPLACE FUNCTION validar_compra_operacion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
    (OLD.estado = 'borrador' AND NEW.estado IN ('recibida', 'cancelada')) OR
    (OLD.estado = 'recibida' AND NEW.estado = 'cancelada')
  ) THEN RAISE EXCEPTION 'Transición de compra inválida: % a %', OLD.estado, NEW.estado; END IF;
  IF NEW.estado_pago IS DISTINCT FROM OLD.estado_pago AND NOT (
    (OLD.estado_pago = 'pendiente' AND NEW.estado_pago = 'pagada') OR
    (OLD.estado_pago = 'pagada' AND NEW.estado_pago = 'anulada')
  ) THEN RAISE EXCEPTION 'Transición de pago de compra inválida'; END IF;
  IF NEW.estado_pago = 'pagada' AND NEW.estado <> 'recibida' THEN RAISE EXCEPTION 'Solo se puede pagar una compra recibida'; END IF;
  IF OLD.estado_pago = 'pagada' AND
     (NEW.fk_idforma_pago IS DISTINCT FROM OLD.fk_idforma_pago OR NEW.importe_pagado IS DISTINCT FROM OLD.importe_pagado OR NEW.total IS DISTINCT FROM OLD.total) THEN
    RAISE EXCEPTION 'Una compra pagada no puede cambiar forma ni importe';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validar_compra BEFORE UPDATE ON compra FOR EACH ROW EXECUTE PROCEDURE validar_compra_operacion();

CREATE OR REPLACE FUNCTION registrar_compra_recibida(p_idcompra integer, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE d record; v_total numeric(14,0); v_base numeric(14,0); v_unidad_base integer; v_precio_base numeric(14,0);
BEGIN
  PERFORM 1 FROM compra WHERE idcompra = p_idcompra AND estado = 'borrador' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La compra no existe o no está en borrador: %', p_idcompra; END IF;
  IF NOT EXISTS (SELECT 1 FROM detalle_compra WHERE fk_idcompra = p_idcompra) AND
     NOT EXISTS (SELECT 1 FROM detalle_compra_producto WHERE fk_idcompra = p_idcompra) THEN
    RAISE EXCEPTION 'La compra debe tener al menos un detalle';
  END IF;
  v_total := COALESCE((SELECT sum(cantidad * precio_compra) FROM detalle_compra WHERE fk_idcompra = p_idcompra), 0) +
             COALESCE((SELECT sum(cantidad * precio_compra) FROM detalle_compra_producto WHERE fk_idcompra = p_idcompra), 0);
  FOR d IN SELECT dc.*, i.fk_idunidad_medida AS unidad_base FROM detalle_compra dc JOIN ingrediente i ON i.idingrediente = dc.fk_idingrediente WHERE dc.fk_idcompra = p_idcompra LOOP
    v_base := convertir_cantidad(d.cantidad, d.fk_idunidad_medida, d.unidad_base);
    IF v_base = 0 OR (d.cantidad * d.precio_compra) / v_base <> trunc((d.cantidad * d.precio_compra) / v_base) THEN
      RAISE EXCEPTION 'La compra produce un precio unitario decimal y no está permitido';
    END IF;
    v_precio_base := ((d.cantidad * d.precio_compra) / v_base)::numeric(14,0);
    UPDATE detalle_compra SET cantidad_base = v_base WHERE iddetalle_compra = d.iddetalle_compra;
    UPDATE ingrediente SET stock_actual = stock_actual + v_base, precio_compra = v_precio_base WHERE idingrediente = d.fk_idingrediente;
    INSERT INTO movimiento_stock (fk_idingrediente, fk_idcompra, fk_idunidad_medida, tipo, cantidad, cantidad_origen, costo_unitario, motivo, creado_por)
    VALUES (d.fk_idingrediente, p_idcompra, d.fk_idunidad_medida, 'compra', v_base, d.cantidad, v_precio_base, 'Compra recibida', p_creado_por);
  END LOOP;
  FOR d IN SELECT * FROM detalle_compra_producto WHERE fk_idcompra = p_idcompra LOOP
    UPDATE producto_menu SET stock_actual = stock_actual + d.cantidad, precio_compra = d.precio_compra WHERE idproducto_menu = d.fk_idproducto_menu;
    INSERT INTO movimiento_stock_producto (fk_idproducto_menu, fk_idcompra, tipo, cantidad, costo_unitario, motivo, creado_por)
    VALUES (d.fk_idproducto_menu, p_idcompra, 'compra', d.cantidad, d.precio_compra, 'Compra recibida', p_creado_por);
  END LOOP;
  UPDATE compra SET estado = 'recibida', total = v_total WHERE idcompra = p_idcompra;
END;
$$;

CREATE OR REPLACE FUNCTION pagar_compra(p_idcompra integer, p_fk_idforma_pago integer, p_pagado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_compra compra%ROWTYPE; v_activo boolean; v_egreso boolean;
BEGIN
  SELECT * INTO v_compra FROM compra WHERE idcompra = p_idcompra FOR UPDATE;
  IF NOT FOUND OR v_compra.estado <> 'recibida' OR v_compra.estado_pago <> 'pendiente' THEN RAISE EXCEPTION 'La compra no está recibida y pendiente de pago'; END IF;
  SELECT activo, es_egreso INTO v_activo, v_egreso FROM forma_pago WHERE idforma_pago = p_fk_idforma_pago;
  IF NOT FOUND OR NOT v_activo OR NOT v_egreso THEN RAISE EXCEPTION 'La forma de pago no está activa para egresos'; END IF;
  UPDATE compra SET fk_idforma_pago = p_fk_idforma_pago, estado_pago = 'pagada', importe_pagado = total,
    fecha_pago = CURRENT_TIMESTAMP, pagado_por = p_pagado_por WHERE idcompra = p_idcompra;
END;
$$;

CREATE OR REPLACE FUNCTION asegurar_receta_pedido(p_idpedido integer, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO detalle_pedido_receta (fk_iddetalle_pedido, fk_idingrediente, cantidad_base, creado_por)
  SELECT dp.iddetalle_pedido, r.fk_idingrediente,
         convertir_cantidad(r.cantidad, r.fk_idunidad_medida, i.fk_idunidad_medida), p_creado_por
  FROM detalle_pedido dp
  JOIN receta r ON r.fk_idproducto_menu = dp.fk_idproducto_menu
  JOIN ingrediente i ON i.idingrediente = r.fk_idingrediente
  WHERE dp.fk_idpedido = p_idpedido AND dp.usa_receta_stock = true
  ON CONFLICT (fk_iddetalle_pedido, fk_idingrediente) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION sincronizar_stock_pedido(p_idpedido integer, p_idusuario integer DEFAULT NULL, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE x record; v_estado estado_pedido;
BEGIN
  SELECT estado INTO v_estado FROM pedido WHERE idpedido = p_idpedido FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido % no existe', p_idpedido; END IF;
  PERFORM asegurar_receta_pedido(p_idpedido, p_creado_por);
  FOR x IN
    WITH objetivo AS (
      SELECT dpr.fk_idingrediente,
        CASE WHEN v_estado = 'cancelado' THEN 0 ELSE sum(dp.cantidad * dpr.cantidad_base) END AS cantidad
      FROM detalle_pedido dp JOIN detalle_pedido_receta dpr ON dpr.fk_iddetalle_pedido = dp.iddetalle_pedido
      JOIN producto_menu pm ON pm.idproducto_menu = dp.fk_idproducto_menu
      WHERE dp.fk_idpedido = p_idpedido AND dp.estado <> 'cancelado' AND pm.es_descontar_stock
      GROUP BY dpr.fk_idingrediente
    ), aplicado AS (
      SELECT fk_idingrediente, sum(CASE WHEN tipo = 'consumo' THEN cantidad WHEN tipo = 'devolucion' THEN -cantidad ELSE 0 END) AS cantidad
      FROM movimiento_stock WHERE fk_idpedido = p_idpedido GROUP BY fk_idingrediente
    )
    SELECT i.idingrediente, i.fk_idunidad_medida, COALESCE(o.cantidad, 0) objetivo, COALESCE(a.cantidad, 0) aplicado
    FROM ingrediente i JOIN (SELECT fk_idingrediente FROM objetivo UNION SELECT fk_idingrediente FROM aplicado) ids ON ids.fk_idingrediente = i.idingrediente
    LEFT JOIN objetivo o ON o.fk_idingrediente = i.idingrediente LEFT JOIN aplicado a ON a.fk_idingrediente = i.idingrediente
  LOOP
    IF x.objetivo > x.aplicado THEN
      UPDATE ingrediente SET stock_actual = stock_actual - (x.objetivo - x.aplicado)
      WHERE idingrediente = x.idingrediente AND stock_actual >= (x.objetivo - x.aplicado);
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuficiente para ingrediente %', x.idingrediente; END IF;
      INSERT INTO movimiento_stock (fk_idingrediente, fk_idusuario, fk_idpedido, fk_idunidad_medida, tipo, cantidad, motivo, creado_por)
      VALUES (x.idingrediente, p_idusuario, p_idpedido, x.fk_idunidad_medida, 'consumo', x.objetivo - x.aplicado, 'Sincronización de pedido', p_creado_por);
    ELSIF x.objetivo < x.aplicado THEN
      UPDATE ingrediente SET stock_actual = stock_actual + (x.aplicado - x.objetivo) WHERE idingrediente = x.idingrediente;
      INSERT INTO movimiento_stock (fk_idingrediente, fk_idusuario, fk_idpedido, fk_idunidad_medida, tipo, cantidad, motivo, creado_por)
      VALUES (x.idingrediente, p_idusuario, p_idpedido, x.fk_idunidad_medida, 'devolucion', x.aplicado - x.objetivo, 'Ajuste por edición o anulación', p_creado_por);
    END IF;
  END LOOP;
  FOR x IN
    WITH objetivo AS (
      SELECT dp.fk_idproducto_menu,
        CASE WHEN v_estado = 'cancelado' THEN 0 ELSE sum(dp.cantidad) END AS cantidad
      FROM detalle_pedido dp JOIN producto_menu pm ON pm.idproducto_menu = dp.fk_idproducto_menu
      WHERE dp.fk_idpedido = p_idpedido AND dp.estado <> 'cancelado' AND pm.es_descontar_stock AND dp.usa_receta_stock = false
      GROUP BY dp.fk_idproducto_menu
    ), aplicado AS (
      SELECT fk_idproducto_menu, sum(CASE WHEN tipo = 'consumo' THEN cantidad WHEN tipo = 'devolucion' THEN -cantidad ELSE 0 END) AS cantidad
      FROM movimiento_stock_producto WHERE fk_idpedido = p_idpedido GROUP BY fk_idproducto_menu
    )
    SELECT pm.idproducto_menu, COALESCE(o.cantidad, 0) objetivo, COALESCE(a.cantidad, 0) aplicado
    FROM producto_menu pm JOIN (SELECT fk_idproducto_menu FROM objetivo UNION SELECT fk_idproducto_menu FROM aplicado) ids ON ids.fk_idproducto_menu = pm.idproducto_menu
    LEFT JOIN objetivo o ON o.fk_idproducto_menu = pm.idproducto_menu LEFT JOIN aplicado a ON a.fk_idproducto_menu = pm.idproducto_menu
  LOOP
    IF x.objetivo > x.aplicado THEN
      UPDATE producto_menu SET stock_actual = stock_actual - (x.objetivo - x.aplicado)
      WHERE idproducto_menu = x.idproducto_menu AND stock_actual >= (x.objetivo - x.aplicado);
      IF NOT FOUND THEN RAISE EXCEPTION 'Stock insuficiente para producto %', x.idproducto_menu; END IF;
      INSERT INTO movimiento_stock_producto (fk_idproducto_menu, fk_idusuario, fk_idpedido, tipo, cantidad, motivo, creado_por)
      VALUES (x.idproducto_menu, p_idusuario, p_idpedido, 'consumo', x.objetivo - x.aplicado, 'Sincronización de pedido', p_creado_por);
    ELSIF x.objetivo < x.aplicado THEN
      UPDATE producto_menu SET stock_actual = stock_actual + (x.aplicado - x.objetivo) WHERE idproducto_menu = x.idproducto_menu;
      INSERT INTO movimiento_stock_producto (fk_idproducto_menu, fk_idusuario, fk_idpedido, tipo, cantidad, motivo, creado_por)
      VALUES (x.idproducto_menu, p_idusuario, p_idpedido, 'devolucion', x.aplicado - x.objetivo, 'Ajuste por edición o anulación', p_creado_por);
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION confirmar_pedido(p_idpedido integer, p_idusuario integer DEFAULT NULL, p_confirmado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM detalle_pedido WHERE fk_idpedido = p_idpedido AND estado <> 'cancelado') THEN RAISE EXCEPTION 'El pedido debe tener al menos un detalle'; END IF;
  UPDATE pedido SET estado = 'confirmado', fecha_confirmado = CURRENT_TIMESTAMP, confirmado_por = p_confirmado_por
  WHERE idpedido = p_idpedido AND estado = 'abierto';
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no existe o no está abierto'; END IF;
  PERFORM sincronizar_stock_pedido(p_idpedido, p_idusuario, p_confirmado_por);
END;
$$;

CREATE OR REPLACE FUNCTION anular_pedido(p_idpedido integer, p_idusuario integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pedido SET estado = 'cancelado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo
  WHERE idpedido = p_idpedido AND estado IN ('abierto', 'confirmado', 'en_preparacion', 'listo');
  IF NOT FOUND THEN RAISE EXCEPTION 'El pedido no admite anulación'; END IF;
  PERFORM sincronizar_stock_pedido(p_idpedido, p_idusuario, p_anulado_por);
END;
$$;

CREATE OR REPLACE FUNCTION consumir_stock_pedido(p_idpedido integer, p_idusuario integer DEFAULT NULL, p_creado_por text DEFAULT 'SISTEMA')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pedido WHERE idpedido = p_idpedido AND estado = 'abierto') THEN
    PERFORM confirmar_pedido(p_idpedido, p_idusuario, p_creado_por);
  ELSE
    PERFORM sincronizar_stock_pedido(p_idpedido, p_idusuario, p_creado_por);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION sincronizar_stock_por_estado_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estado IN ('confirmado', 'cancelado') AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    PERFORM sincronizar_stock_pedido(NEW.idpedido, NULL, COALESCE(NEW.confirmado_por, NEW.anulado_por, NEW.creado_por));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_pedido_estado_stock AFTER UPDATE OF estado ON pedido
FOR EACH ROW EXECUTE PROCEDURE sincronizar_stock_por_estado_pedido();

CREATE OR REPLACE FUNCTION sincronizar_stock_por_detalle()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_idpedido integer; v_estado estado_pedido;
BEGIN
  v_idpedido := COALESCE(NEW.fk_idpedido, OLD.fk_idpedido);
  SELECT estado INTO v_estado FROM pedido WHERE idpedido = v_idpedido;
  IF v_estado IN ('confirmado', 'en_preparacion', 'listo') THEN PERFORM sincronizar_stock_pedido(v_idpedido, NULL, COALESCE(NEW.creado_por, OLD.creado_por)); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_detalle_stock AFTER INSERT OR UPDATE OR DELETE ON detalle_pedido
FOR EACH ROW EXECUTE PROCEDURE sincronizar_stock_por_detalle();

CREATE OR REPLACE FUNCTION anular_compra(p_idcompra integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_compra compra%ROWTYPE; x record;
BEGIN
  SELECT * INTO v_compra FROM compra WHERE idcompra = p_idcompra FOR UPDATE;
  IF NOT FOUND OR v_compra.estado = 'cancelada' THEN RAISE EXCEPTION 'La compra no existe o ya está cancelada'; END IF;
  IF v_compra.estado = 'recibida' THEN
    FOR x IN SELECT * FROM movimiento_stock WHERE fk_idcompra = p_idcompra AND tipo = 'compra' LOOP
      UPDATE ingrediente SET stock_actual = stock_actual - x.cantidad WHERE idingrediente = x.fk_idingrediente AND stock_actual >= x.cantidad;
      IF NOT FOUND THEN RAISE EXCEPTION 'No hay stock suficiente para anular la compra'; END IF;
      INSERT INTO movimiento_stock (fk_idingrediente, fk_idcompra, fk_idunidad_medida, tipo, cantidad, cantidad_origen, costo_unitario, motivo, creado_por)
      VALUES (x.fk_idingrediente, p_idcompra, x.fk_idunidad_medida, 'ajuste_salida', x.cantidad, x.cantidad_origen, x.costo_unitario, 'Anulación de compra', p_anulado_por);
    END LOOP;
    FOR x IN SELECT * FROM movimiento_stock_producto WHERE fk_idcompra = p_idcompra AND tipo = 'compra' LOOP
      UPDATE producto_menu SET stock_actual = stock_actual - x.cantidad WHERE idproducto_menu = x.fk_idproducto_menu AND stock_actual >= x.cantidad;
      IF NOT FOUND THEN RAISE EXCEPTION 'No hay stock de producto suficiente para anular la compra'; END IF;
      INSERT INTO movimiento_stock_producto (fk_idproducto_menu, fk_idcompra, tipo, cantidad, costo_unitario, motivo, creado_por)
      VALUES (x.fk_idproducto_menu, p_idcompra, 'ajuste_salida', x.cantidad, x.costo_unitario, 'Anulación de compra', p_anulado_por);
    END LOOP;
  END IF;
  UPDATE compra SET estado = 'cancelada', estado_pago = CASE WHEN estado_pago = 'pagada' THEN 'anulada' ELSE estado_pago END,
    fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo WHERE idcompra = p_idcompra;
END;
$$;

CREATE OR REPLACE FUNCTION validar_detalle_compra_editable()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_idcompra integer; v_estado estado_compra; v_unidad_base integer;
BEGIN
  v_idcompra := COALESCE(NEW.fk_idcompra, OLD.fk_idcompra);
  SELECT estado INTO v_estado FROM compra WHERE idcompra = v_idcompra;
  IF NOT FOUND OR v_estado <> 'borrador' THEN RAISE EXCEPTION 'Solo se pueden modificar detalles de una compra en borrador'; END IF;
  IF TG_OP = 'UPDATE' AND NEW.fk_idcompra IS DISTINCT FROM OLD.fk_idcompra THEN RAISE EXCEPTION 'No se puede mover el detalle a otra compra'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'detalle_compra' THEN
    SELECT fk_idunidad_medida INTO v_unidad_base FROM ingrediente WHERE idingrediente = NEW.fk_idingrediente AND activo;
    IF NOT FOUND THEN RAISE EXCEPTION 'El ingrediente no existe o está inactivo'; END IF;
    PERFORM convertir_cantidad(NEW.cantidad, NEW.fk_idunidad_medida, v_unidad_base);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM producto_menu WHERE idproducto_menu = NEW.fk_idproducto_menu AND activo AND es_comprar) THEN
      RAISE EXCEPTION 'El producto no existe o no está habilitado para compras';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_detalle_compra_editable BEFORE INSERT OR UPDATE OR DELETE ON detalle_compra
FOR EACH ROW EXECUTE PROCEDURE validar_detalle_compra_editable();
CREATE TRIGGER trg_detalle_compra_producto_editable BEFORE INSERT OR UPDATE OR DELETE ON detalle_compra_producto
FOR EACH ROW EXECUTE PROCEDURE validar_detalle_compra_editable();

CREATE OR REPLACE FUNCTION aprobar_pago(p_idpago integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pago SET estado = 'aprobado' WHERE idpago = p_idpago AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no existe o no está pendiente'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION anular_pago(p_idpago integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE pago SET estado = 'anulado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo
  WHERE idpago = p_idpago AND estado IN ('pendiente', 'aprobado');
  IF NOT FOUND THEN RAISE EXCEPTION 'El pago no admite anulación'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pagar_gasto(p_idgasto integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE gasto SET estado = 'pagado' WHERE idgasto = p_idgasto AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no existe o no está pendiente'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION anular_gasto(p_idgasto integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE gasto SET estado = 'anulado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo
  WHERE idgasto = p_idgasto AND estado IN ('pendiente', 'pagado');
  IF NOT FOUND THEN RAISE EXCEPTION 'El gasto no admite anulación'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION pagar_vale(p_idvale integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vale SET estado = 'pagado' WHERE idvale = p_idvale AND estado = 'pendiente';
  IF NOT FOUND THEN RAISE EXCEPTION 'El vale no existe o no está pendiente'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION anular_vale(p_idvale integer, p_anulado_por text, p_motivo text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE vale SET estado = 'anulado', fecha_anulado = CURRENT_TIMESTAMP, anulado_por = p_anulado_por, motivo_anulado = p_motivo
  WHERE idvale = p_idvale AND estado IN ('pendiente', 'pagado');
  IF NOT FOUND THEN RAISE EXCEPTION 'El vale no admite anulación'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION impedir_borrado_operativo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'No se permite borrar físicamente registros operativos de %', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER trg_no_borrar_cuenta BEFORE DELETE ON cuenta FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_pedido BEFORE DELETE ON pedido FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_pago BEFORE DELETE ON pago FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_compra BEFORE DELETE ON compra FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_gasto BEFORE DELETE ON gasto FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_vale BEFORE DELETE ON vale FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_caja BEFORE DELETE ON caja_gral FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_caja_item BEFORE DELETE ON caja_item FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_caja_arqueo BEFORE DELETE ON caja_arqueo FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_movimiento_stock BEFORE DELETE ON movimiento_stock FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();
CREATE TRIGGER trg_no_borrar_movimiento_producto BEFORE DELETE ON movimiento_stock_producto FOR EACH ROW EXECUTE PROCEDURE impedir_borrado_operativo();

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
CREATE OR REPLACE FUNCTION validar_transicion_pedido()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NOT (
      (OLD.estado = 'abierto' AND NEW.estado IN ('confirmado', 'cancelado')) OR
      (OLD.estado = 'confirmado' AND NEW.estado IN ('en_preparacion', 'cancelado')) OR
      (OLD.estado = 'en_preparacion' AND NEW.estado IN ('listo', 'cancelado')) OR
      (OLD.estado = 'listo' AND NEW.estado IN ('entregado', 'pagado', 'cancelado')) OR
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
  UPDATE pedido SET estado = 'pagado', version_web = version_web + 1
  WHERE fk_idcuenta = p_idcuenta AND estado IN ('listo', 'entregado');
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

-- Configuración de la Comanda: colores por tiempo, pase automático a TERMINADO y refrescos.
CREATE SEQUENCE IF NOT EXISTS comanda_color_id_seq;

CREATE TABLE IF NOT EXISTS comanda_config (
  idcomanda_config integer PRIMARY KEY DEFAULT 1 CHECK (idcomanda_config = 1),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_modificado timestamp,
  modificado_por text,
  limite_terminado_min integer NOT NULL DEFAULT 60 CHECK (limite_terminado_min BETWEEN 1 AND 1440),
  pase_automatico boolean NOT NULL DEFAULT true,
  anulado_visible_seg integer NOT NULL DEFAULT 30 CHECK (anulado_visible_seg BETWEEN 5 AND 600),
  refresco_seg integer NOT NULL DEFAULT 3 CHECK (refresco_seg BETWEEN 1 AND 60),
  chequeo_limite_seg integer NOT NULL DEFAULT 15 CHECK (chequeo_limite_seg BETWEEN 5 AND 300)
);
INSERT INTO comanda_config (idcomanda_config) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS comanda_color (
  idcomanda_color integer PRIMARY KEY DEFAULT nextval('comanda_color_id_seq'),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  desde_minuto integer NOT NULL CHECK (desde_minuto BETWEEN 0 AND 1440),
  color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT comanda_color_minuto_unico UNIQUE (desde_minuto)
);
INSERT INTO comanda_color (desde_minuto, color)
SELECT v.desde_minuto, v.color FROM (VALUES (0, '#ffffff'), (10, '#fff09a'), (20, '#ffc287'), (30, '#c8ced1'), (40, '#a8d6f4'), (50, '#ffb3b3')) AS v(desde_minuto, color)
WHERE NOT EXISTS (SELECT 1 FROM comanda_color)
ON CONFLICT DO NOTHING;

-- Auditoría de acciones sensibles: quién, cuándo, desde qué IP, qué cambió (antes/después) y por qué.
-- Solo se agregan filas; un trigger impide modificarlas o borrarlas. Compatible con PostgreSQL 9.5.
CREATE TABLE IF NOT EXISTS auditoria (
  idauditoria bigserial PRIMARY KEY,
  fecha timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fk_idusuario integer REFERENCES usuario(idusuario),
  usuario_login text NOT NULL,
  ip varchar(64),
  accion varchar(60) NOT NULL,
  entidad varchar(40) NOT NULL,
  id_entidad integer,
  antes jsonb,
  despues jsonb,
  motivo text
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_accion_fecha_idx ON auditoria (accion, fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_usuario_fecha_idx ON auditoria (usuario_login, fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_entidad_idx ON auditoria (entidad, id_entidad);

CREATE OR REPLACE FUNCTION auditoria_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se puede modificar ni borrar';
END;
$$;
DROP TRIGGER IF EXISTS auditoria_inmutable_fila ON auditoria;
CREATE TRIGGER auditoria_inmutable_fila BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE PROCEDURE auditoria_inmutable();
DROP TRIGGER IF EXISTS auditoria_inmutable_truncate ON auditoria;
CREATE TRIGGER auditoria_inmutable_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE PROCEDURE auditoria_inmutable();

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
