-- Permiso del rol "Pedidos: ver solo los propios": con él, en Pedidos el usuario solo ve los pedidos que creó.
-- No se asigna a ningún rol: se marca a mano en Roles → Permisos.
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Pedidos: ver solo los propios','En Pedidos, el usuario solo ve los pedidos que él creó. Sin este permiso ve todos.','FORM_PEDIDOS_SOLO_PROPIOS','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_PEDIDOS_SOLO_PROPIOS');
-- Reemplaza la opción por usuario que existió brevemente durante el desarrollo.
ALTER TABLE usuario DROP COLUMN IF EXISTS solo_pedidos_propios;
