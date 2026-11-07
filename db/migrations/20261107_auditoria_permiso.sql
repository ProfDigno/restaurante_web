-- Permiso del formulario Auditoría (solo rol admin).
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Auditoría','Acceso al registro de auditoría de acciones sensibles','FORM_AUDITORIA','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_AUDITORIA');

INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento='FORM_AUDITORIA'
WHERE r.rol='admin'
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item i WHERE i.fk_idusuario_rol=r.idusuario_rol AND i.fk_idusuario_rol_evento=e.idusuario_rol_evento);
