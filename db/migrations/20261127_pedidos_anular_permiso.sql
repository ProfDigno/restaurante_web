-- Permiso del rol "Pedidos: anular": sin él, el botón ANULAR de Pedidos muestra un aviso y la API rechaza la anulación.
-- Al instalarlo se asigna a los roles admin/administrador y a los que administran Permisos; a los demás se les marca a mano en Roles → Permisos.
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Pedidos: anular','Permite anular pedidos. Sin este permiso el botón ANULAR muestra un aviso.','FORM_PEDIDOS_ANULAR','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_PEDIDOS_ANULAR');
INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT r.idusuario_rol,e.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento='FORM_PEDIDOS_ANULAR'
WHERE (lower(btrim(r.rol)) IN ('admin','administrador') OR EXISTS (SELECT 1 FROM usuario_rol_item pi JOIN usuario_rol_evento pe ON pe.idusuario_rol_evento=pi.fk_idusuario_rol_evento
    WHERE pi.fk_idusuario_rol=r.idusuario_rol AND pi.activo AND pe.codigo_evento='FORM_PERMISOS'))
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item i WHERE i.fk_idusuario_rol=r.idusuario_rol AND i.fk_idusuario_rol_evento=e.idusuario_rol_evento);
