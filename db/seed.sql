-- Datos de desarrollo. Las contraseñas son hashes de ejemplo y deben reemplazarse.
INSERT INTO usuario_rol (rol, creado_por) VALUES
  ('admin', 'SISTEMA'), ('encargado', 'SISTEMA'), ('mozo', 'SISTEMA') ON CONFLICT (rol) DO NOTHING;
INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Administrar usuarios', 'Crear y modificar usuarios', 'USUARIO_GESTIONAR', 'SISTEMA'),
  ('Administrar menú', 'Crear y modificar productos del menú', 'MENU_GESTIONAR', 'SISTEMA'),
  ('Registrar pedidos', 'Crear y modificar pedidos', 'PEDIDO_GESTIONAR', 'SISTEMA'),
  ('Registrar pagos', 'Registrar pagos de cuentas', 'PAGO_GESTIONAR', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r CROSS JOIN usuario_rol_evento e
WHERE r.rol = 'admin' ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento IN ('PEDIDO_GESTIONAR', 'PAGO_GESTIONAR')
WHERE r.rol = 'encargado' ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento = 'PEDIDO_GESTIONAR'
WHERE r.rol = 'mozo' ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Mesas', 'Acceso al formulario Mesas', 'FORM_MESAS', 'SISTEMA'),
  ('Historial de mesas', 'Acceso al historial de mesas', 'FORM_HISTORIAL_MESAS', 'SISTEMA'),
  ('Pedidos', 'Acceso al formulario Pedidos', 'FORM_PEDIDOS', 'SISTEMA'),
  ('Comanda', 'Acceso al formulario Comanda', 'FORM_COMANDA', 'SISTEMA'),
  ('Análisis de pedidos', 'Acceso al análisis de pedidos', 'FORM_KPI_PEDIDOS', 'SISTEMA'),
  ('Análisis de rentabilidad', 'Acceso al análisis de rentabilidad por producto y categoría', 'FORM_KPI_RENTABILIDAD', 'SISTEMA'),
  ('Gastos', 'Acceso al formulario Gastos', 'FORM_GASTOS', 'SISTEMA'),
  ('Análisis de gastos', 'Acceso al análisis de gastos', 'FORM_KPI_GASTOS', 'SISTEMA'),
  ('Análisis de compras', 'Acceso al análisis de compras', 'FORM_KPI_COMPRAS', 'SISTEMA'),
  ('Personal', 'Acceso al formulario Personal (RR.HH.)', 'FORM_PERSONAL', 'SISTEMA'),
  ('Vales', 'Acceso al formulario Vales (RR.HH.)', 'FORM_VALES', 'SISTEMA'),
  ('Cargos', 'Acceso al catálogo de cargos del personal (RR.HH.)', 'FORM_CARGOS', 'SISTEMA'),
  ('Análisis de vales', 'Acceso al análisis de vales del personal (RR.HH.)', 'FORM_KPI_VALES', 'SISTEMA'),
  ('Compra', 'Acceso al formulario Compra', 'FORM_COMPRAS', 'SISTEMA'),
  ('Proveedor', 'Acceso al formulario Proveedor', 'FORM_PROVEEDORES', 'SISTEMA'),
  ('Tipos de gasto', 'Acceso al formulario Tipos de gasto', 'FORM_GASTO_TIPOS', 'SISTEMA'),
  ('Delivery', 'Acceso al formulario Delivery', 'FORM_DELIVERY', 'SISTEMA'),
  ('Productos del menú', 'Acceso al formulario Productos del menú', 'FORM_MENU', 'SISTEMA'),
  ('Categorías', 'Acceso al formulario Categorías', 'FORM_CATEGORIAS', 'SISTEMA'),
  ('Grupos de menú', 'Acceso al formulario Grupos de menú', 'FORM_GRUPOS', 'SISTEMA'),
  ('Unidades de menú', 'Acceso al formulario Unidades de menú', 'FORM_UNIDADES_MENU', 'SISTEMA'),
  ('Ubicaciones de mesas', 'Acceso al formulario Ubicaciones de mesas', 'FORM_UBICACIONES_MESA', 'SISTEMA'),
  ('Configuración de mesas', 'Acceso al formulario Configuración de mesas', 'FORM_MESAS_CONFIG', 'SISTEMA'),
  ('Ingredientes', 'Acceso al formulario Ingredientes', 'FORM_INGREDIENTES', 'SISTEMA'),
  ('Unidades de medida', 'Acceso al formulario Unidades de medida', 'FORM_UNIDADES_MEDIDA', 'SISTEMA'),
  ('Conversiones de unidades', 'Acceso al formulario Conversiones de unidades', 'FORM_CONVERSIONES_UNIDAD', 'SISTEMA'),
  ('Caja general', 'Acceso al formulario Caja general', 'FORM_CAJA', 'SISTEMA'),
  ('Formas de pago', 'Acceso al formulario Formas de pago', 'FORM_FORMAS_PAGO', 'SISTEMA'),
  ('Clientes', 'Acceso al formulario Clientes', 'FORM_CLIENTES', 'SISTEMA'),
  ('Zonas de clientes', 'Acceso al formulario Zonas de clientes', 'FORM_ZONAS', 'SISTEMA'),
  ('Usuarios', 'Acceso al formulario Usuarios', 'FORM_USUARIOS', 'SISTEMA'),
  ('Roles', 'Acceso al formulario Roles', 'FORM_ROLES', 'SISTEMA'),
  ('Permisos', 'Acceso al formulario Permisos', 'FORM_PERMISOS', 'SISTEMA'),
  ('Facturas', 'Acceso al formulario Facturas', 'FORM_FACTURAS', 'SISTEMA'),
  ('Datos de restaurante', 'Acceso a los datos de restaurante y conexión de facturación', 'FORM_DATOS_RESTAURANTE', 'SISTEMA'),
  ('Configuración de comanda', 'Acceso a la configuración de la comanda', 'FORM_CONFIGURACION_COMANDA', 'SISTEMA'),
  ('Auditoría', 'Acceso al registro de auditoría de acciones sensibles', 'FORM_AUDITORIA', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento LIKE 'FORM_%'
WHERE r.rol = 'admin' OR (r.rol = 'encargado' AND e.codigo_evento NOT IN ('FORM_USUARIOS','FORM_ROLES','FORM_PERMISOS','FORM_PERSONAL','FORM_CARGOS','FORM_VALES','FORM_KPI_VALES','FORM_AUDITORIA'))
  OR (r.rol = 'mozo' AND e.codigo_evento IN ('FORM_MESAS','FORM_PEDIDOS','FORM_COMANDA'))
ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
INSERT INTO usuario (login, nombre, password_hash, fk_idusuario_rol, creado_por)
SELECT v.login, v.nombre, v.password_hash, r.idusuario_rol, 'SISTEMA'
FROM (VALUES
  ('admin', 'Administrador', '$2a$10$TLmXDMeLVLIY4dpUJ60JFez4IIeq2XqtVQ4882CsJFuMs/7/r6Tvi', 'admin'),
  ('encargado', 'Encargado', '$2a$10$zTHbzyEc7aJJGfLdQ4TCJO6taQHRXEuyrsL.eavue4jEmomBmTtCi', 'encargado'),
  ('mozo', 'Mozo Demo', '$2a$10$Vghv7ONPaszDiKSXf3K8U.e4Kj1G2sMarTiffomKhRw95ivlYqVuy', 'mozo')
) AS v(login, nombre, password_hash, rol)
JOIN usuario_rol r ON r.rol = v.rol
ON CONFLICT (login) DO NOTHING;

INSERT INTO categoria_menu (nombre, descripcion, orden, creado_por) VALUES
  ('Entradas', 'Para comenzar', 1, 'SISTEMA'), ('Platos principales', 'Especialidades de la casa', 2, 'SISTEMA'),
  ('Bebidas', 'Bebidas frías y calientes', 3, 'SISTEMA'), ('Postres', 'Opciones dulces', 4, 'SISTEMA')
ON CONFLICT (nombre) DO NOTHING;
INSERT INTO unidad_menu (nombre, orden, creado_por) VALUES
  ('Unidad', 1, 'SISTEMA'), ('Porción', 2, 'SISTEMA'), ('Botella', 3, 'SISTEMA'), ('Litro', 4, 'SISTEMA')
ON CONFLICT (nombre) DO NOTHING;
INSERT INTO grupo_menu (nombre, orden, creado_por) VALUES
  ('Comida', 1, 'SISTEMA'), ('Bebida', 2, 'SISTEMA'), ('Postre', 3, 'SISTEMA')
ON CONFLICT (nombre) DO NOTHING;
INSERT INTO unidad_medida (codigo, nombre, creado_por) VALUES
  ('UN', 'Unidad', 'SISTEMA'), ('KG', 'Kilogramo', 'SISTEMA'), ('G', 'Gramo', 'SISTEMA'),
  ('L', 'Litro', 'SISTEMA'), ('ML', 'Mililitro', 'SISTEMA')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO unidad_conversion (fk_idunidad_origen, fk_idunidad_destino, factor, creado_por)
SELECT o.idunidad_medida, d.idunidad_medida, v.factor, 'SISTEMA'
FROM (VALUES ('KG', 'G', 1000::numeric), ('L', 'ML', 1000::numeric)) v(origen, destino, factor)
JOIN unidad_medida o ON o.codigo = v.origen JOIN unidad_medida d ON d.codigo = v.destino
ON CONFLICT (fk_idunidad_origen, fk_idunidad_destino) DO NOTHING;
INSERT INTO ubicacion_mesa (nombre, orden, creado_por) VALUES
  ('Salón', 1, 'SISTEMA'), ('Terraza', 2, 'SISTEMA')
ON CONFLICT DO NOTHING;
INSERT INTO mesa (numero, capacidad, fk_idubicacion_mesa, creado_por)
SELECT v.numero, v.capacidad, u.idubicacion_mesa, 'SISTEMA'
FROM (VALUES (1, 2, 'Salón'), (2, 2, 'Salón'), (3, 4, 'Salón'), (4, 6, 'Terraza')) v(numero, capacidad, ubicacion)
JOIN ubicacion_mesa u ON lower(btrim(u.nombre)) = lower(btrim(v.ubicacion))
ON CONFLICT (numero) DO NOTHING;
INSERT INTO proveedor (nombre, ruc, direccion, telefono, creado_por)
VALUES ('Proveedor general', '30123456789', 'Av. Proveedores 100', '011-4444-5555', 'SISTEMA')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO zona_cliente (codigo, nombre, precio_delivery, creado_por) VALUES
  ('Z001', 'Zona Centro', 1500, 'SISTEMA'), ('Z002', 'Zona Norte', 2500, 'SISTEMA'), ('Z003', 'Zona Sur', 3000, 'SISTEMA')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO personal (nombre_completo, documento, telefono, limite_monto_vale, creado_por) VALUES
  ('Personal Demo', '30111222333', '011-4000-1000', 5000, 'SISTEMA'),
  ('Personal Administrativo', '30222333444', '011-4000-2000', 10000, 'SISTEMA')
ON CONFLICT (documento) DO NOTHING;
INSERT INTO gasto_tipo (nombre, orden, creado_por) VALUES
  ('Servicios', 1, 'SISTEMA'), ('Mantenimiento', 2, 'SISTEMA'), ('Otros', 3, 'SISTEMA')
ON CONFLICT (nombre) DO NOTHING;
INSERT INTO forma_pago (nombre, es_ingreso, es_egreso, orden, es_default, creado_por) VALUES
  ('Efectivo', true, true, 1, true, 'SISTEMA'), ('Débito', true, true, 2, false, 'SISTEMA'),
  ('Crédito', true, true, 3, false, 'SISTEMA'), ('Transferencia', true, true, 4, false, 'SISTEMA'),
  ('Billetera virtual', true, true, 5, false, 'SISTEMA') ON CONFLICT (nombre) DO NOTHING;
INSERT INTO vale (fk_idpersonal, fk_idforma_pago, descripcion, estado, monto_vale, creado_por)
SELECT p.idpersonal, f.idforma_pago, 'Vale de consumo demo', 'pendiente', 2500, 'SISTEMA'
FROM personal p CROSS JOIN forma_pago f
WHERE p.documento = '30111222333' AND f.nombre = 'Efectivo'
  AND NOT EXISTS (SELECT 1 FROM vale v WHERE v.fk_idpersonal = p.idpersonal AND v.descripcion = 'Vale de consumo demo');
INSERT INTO entregador_delivery (nombre_completo, telefono, creado_por)
SELECT 'Repartidor Principal', '1111111111', 'SISTEMA' WHERE NOT EXISTS (SELECT 1 FROM entregador_delivery WHERE nombre_completo = 'Repartidor Principal');
INSERT INTO entregador_delivery (nombre_completo, telefono, creado_por)
SELECT 'Repartidor Alternativo', '2222222222', 'SISTEMA' WHERE NOT EXISTS (SELECT 1 FROM entregador_delivery WHERE nombre_completo = 'Repartidor Alternativo');
INSERT INTO ingrediente (nombre, fk_idunidad_medida, precio_compra, precio_venta, stock_minimo, creado_por)
SELECT v.nombre, u.idunidad_medida, v.precio_compra, v.precio_venta, v.stock_minimo, 'SISTEMA'
FROM (VALUES
  ('Harina', 'KG', 8000::numeric, 0::numeric, 5::numeric), ('Tomate', 'KG', 4500, 0, 3),
  ('Queso mozzarella', 'KG', 28000, 0, 4), ('Carne vacuna', 'KG', 32000, 0, 5),
  ('Papa', 'KG', 5000, 0, 5), ('Gaseosa', 'UN', 800, 1500, 12)
) v(nombre, unidad, precio_compra, precio_venta, stock_minimo)
JOIN unidad_medida u ON u.codigo = v.unidad
ON CONFLICT (nombre) DO NOTHING;
INSERT INTO cliente (nombre_completo, razon_social, ruc, direccion, telefono, email, fk_idzona_cliente, creado_por)
SELECT 'Cliente Demo', 'Restaurante Demo SA', '20123456789', 'Av. Principal 123', '0000000000', 'cliente@restaurante.local', idzona_cliente, 'SISTEMA'
FROM zona_cliente WHERE codigo = 'Z001'
ON CONFLICT (ruc) DO NOTHING;

INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, orden, stock_actual, stock_minimo, es_descontar_stock, es_cocina, es_vender, es_comprar, creado_por)
SELECT c.idcategoria_menu, u.idunidad_menu, g.idgrupo_menu, 'Gaseosa', 1500, 800, 1, 24, 6, true, false, true, true, 'SISTEMA'
FROM categoria_menu c, unidad_menu u, grupo_menu g
WHERE c.nombre = 'Bebidas' AND u.nombre = 'Botella' AND g.nombre = 'Bebida'
  AND NOT EXISTS (SELECT 1 FROM producto_menu p WHERE p.fk_idcategoria_menu=c.idcategoria_menu AND p.fk_idunidad_menu=u.idunidad_menu AND p.fk_idgrupo_menu=g.idgrupo_menu AND p.nombre='Gaseosa');

INSERT INTO producto_menu (fk_idcategoria_menu, fk_idunidad_menu, fk_idgrupo_menu, nombre, precio_venta, precio_compra, orden, es_descontar_stock, es_cocina, es_vender, es_comprar, creado_por)
SELECT c.idcategoria_menu, u.idunidad_menu, g.idgrupo_menu, 'Plato de la casa', 8500, 4000, 1, true, true, true, false, 'SISTEMA'
FROM categoria_menu c, unidad_menu u, grupo_menu g
WHERE c.nombre = 'Platos principales' AND u.nombre = 'Porción' AND g.nombre = 'Comida'
  AND NOT EXISTS (SELECT 1 FROM producto_menu p WHERE p.fk_idcategoria_menu=c.idcategoria_menu AND p.fk_idunidad_menu=u.idunidad_menu AND p.fk_idgrupo_menu=g.idgrupo_menu AND p.nombre='Plato de la casa');
