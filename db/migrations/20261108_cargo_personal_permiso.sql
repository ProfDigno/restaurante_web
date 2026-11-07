-- Permiso del formulario Cargos (RR.HH.): para los roles que ya tienen el formulario Personal.
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Cargos','Acceso al catálogo de cargos del personal (RR.HH.)','FORM_CARGOS','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_CARGOS');
INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT DISTINCT i.fk_idusuario_rol,nuevo.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol_item i
JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.codigo_evento='FORM_PERSONAL'
CROSS JOIN (SELECT idusuario_rol_evento FROM usuario_rol_evento WHERE codigo_evento='FORM_CARGOS') nuevo
WHERE i.activo
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item x WHERE x.fk_idusuario_rol=i.fk_idusuario_rol AND x.fk_idusuario_rol_evento=nuevo.idusuario_rol_evento);
