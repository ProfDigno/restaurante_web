-- Configuración de la impresora de tickets: ancho del papel, saltos en blanco antes del corte e impresora de Windows.
CREATE TABLE IF NOT EXISTS impresora_config (
  idimpresora_config integer PRIMARY KEY DEFAULT 1 CHECK (idimpresora_config = 1),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_modificado timestamp,
  modificado_por text,
  tamano_ticket integer NOT NULL DEFAULT 80,
  saltos_final integer NOT NULL DEFAULT 5 CHECK (saltos_final BETWEEN 0 AND 30),
  nombre_impresora text
);
INSERT INTO impresora_config (idimpresora_config) VALUES (1) ON CONFLICT DO NOTHING;

-- Papel angosto de 58 mm (una primera versión usaba 56 mm).
ALTER TABLE impresora_config DROP CONSTRAINT IF EXISTS impresora_config_tamano_ticket_check;
UPDATE impresora_config SET tamano_ticket = 58 WHERE tamano_ticket = 56;
ALTER TABLE impresora_config ADD CONSTRAINT impresora_config_tamano_ticket_check CHECK (tamano_ticket IN (58, 80));

INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Configuración de impresora', 'Acceso a la configuración de la impresora de tickets', 'FORM_CONFIGURACION_IMPRESORA', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;

-- Se asigna a los roles de administración (los nombres cambian entre bases: admin, ADMINISTRADOR, PROGRAMADOR…)
-- y a los que ya configuran la Comanda.
INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT DISTINCT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento = 'FORM_CONFIGURACION_IMPRESORA'
WHERE lower(r.rol) IN ('admin', 'administrador', 'programador', 'encargado')
   OR r.idusuario_rol IN (
     SELECT i.fk_idusuario_rol FROM usuario_rol_item i
     JOIN usuario_rol_evento c ON c.idusuario_rol_evento = i.fk_idusuario_rol_evento
     WHERE c.codigo_evento = 'FORM_CONFIGURACION_COMANDA')
ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
