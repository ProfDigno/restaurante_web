INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por) VALUES
  ('Gastos','Acceso al formulario Gastos','FORM_GASTOS','SISTEMA'),
  ('Tipos de gasto','Acceso al formulario Tipos de gasto','FORM_GASTO_TIPOS','SISTEMA')
ON CONFLICT(codigo_evento) DO NOTHING;

INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento IN ('FORM_GASTOS','FORM_GASTO_TIPOS')
WHERE r.rol IN ('admin','encargado')
ON CONFLICT(fk_idusuario_rol,fk_idusuario_rol_evento) DO NOTHING;
