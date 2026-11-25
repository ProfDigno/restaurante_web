-- Caja y finanzas · Máquinas POS: catálogo de máquinas de tarjeta (por ahora sin relación con otras tablas).
-- Nombre y número se guardan sin espacios sobrantes y son únicos sin distinguir mayúsculas. Idempotente.
CREATE SEQUENCE IF NOT EXISTS maquina_pos_id_seq;
CREATE TABLE IF NOT EXISTS maquina_pos (
  idmaquina_pos integer NOT NULL DEFAULT nextval('maquina_pos_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL CONSTRAINT maquina_pos_nombre_limpio CHECK (nombre <> '' AND nombre = btrim(nombre) AND nombre !~ '\s{2,}'),
  numero varchar(40) NOT NULL CONSTRAINT maquina_pos_numero_limpio CHECK (numero <> '' AND numero = btrim(numero) AND numero !~ '\s{2,}'),
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS maquina_pos_nombre_unico ON maquina_pos (lower(nombre));
CREATE UNIQUE INDEX IF NOT EXISTS maquina_pos_numero_unico ON maquina_pos (lower(numero));

-- Permiso del formulario: para los roles que ya tienen Formas de pago.
INSERT INTO usuario_rol_evento(nombre,descripcion,codigo_evento,creado_por)
SELECT 'Máquinas POS','Acceso al catálogo de máquinas POS (Caja y finanzas)','FORM_MAQUINAS_POS','SISTEMA'
WHERE NOT EXISTS (SELECT 1 FROM usuario_rol_evento WHERE codigo_evento='FORM_MAQUINAS_POS');
INSERT INTO usuario_rol_item(fk_idusuario_rol,fk_idusuario_rol_evento,creado_por)
SELECT DISTINCT i.fk_idusuario_rol,nuevo.idusuario_rol_evento,'SISTEMA'
FROM usuario_rol_item i
JOIN usuario_rol_evento e ON e.idusuario_rol_evento=i.fk_idusuario_rol_evento AND e.codigo_evento='FORM_FORMAS_PAGO'
CROSS JOIN (SELECT idusuario_rol_evento FROM usuario_rol_evento WHERE codigo_evento='FORM_MAQUINAS_POS') nuevo
WHERE i.activo
  AND NOT EXISTS (SELECT 1 FROM usuario_rol_item x WHERE x.fk_idusuario_rol=i.fk_idusuario_rol AND x.fk_idusuario_rol_evento=nuevo.idusuario_rol_evento);
