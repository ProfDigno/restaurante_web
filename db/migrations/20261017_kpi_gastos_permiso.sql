INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
VALUES ('Análisis de gastos','Acceso al análisis de gastos','FORM_KPI_GASTOS','SISTEMA')
ON CONFLICT(codigo_evento) DO NOTHING;

INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento='FORM_KPI_GASTOS'
WHERE r.rol IN ('admin','encargado')
ON CONFLICT(fk_idusuario_rol,fk_idusuario_rol_evento) DO NOTHING;
