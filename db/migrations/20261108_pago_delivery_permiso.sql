-- Permiso del formulario Pagos a delivery: para los roles que ya registran Gastos (admin y encargado en el seed).
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Pagos a delivery','Acceso a los pagos a entregadores de delivery','FORM_PAGOS_DELIVERY','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_PAGOS_DELIVERY');
INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT DISTINCT i.fk_idusuario_rol,nuevo.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol_item i
JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.codigo_evento='FORM_GASTOS'
CROSS JOIN (SELECT idusuario_rol_evento FROM usuario_rol_evento WHERE codigo_evento='FORM_PAGOS_DELIVERY') nuevo
WHERE i.activo
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item x WHERE x.fk_idusuario_rol=i.fk_idusuario_rol AND x.fk_idusuario_rol_evento=nuevo.idusuario_rol_evento);
