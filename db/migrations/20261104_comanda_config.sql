-- Configuración de la Comanda: colores por tiempo, pase automático a TERMINADO y refrescos.
CREATE SEQUENCE IF NOT EXISTS comanda_color_id_seq;

CREATE TABLE IF NOT EXISTS comanda_config (
  idcomanda_config integer PRIMARY KEY DEFAULT 1 CHECK (idcomanda_config = 1),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_modificado timestamp,
  modificado_por text,
  limite_terminado_min integer NOT NULL DEFAULT 60 CHECK (limite_terminado_min BETWEEN 1 AND 1440),
  pase_automatico boolean NOT NULL DEFAULT true,
  anulado_visible_seg integer NOT NULL DEFAULT 30 CHECK (anulado_visible_seg BETWEEN 5 AND 600),
  refresco_seg integer NOT NULL DEFAULT 3 CHECK (refresco_seg BETWEEN 1 AND 60),
  chequeo_limite_seg integer NOT NULL DEFAULT 15 CHECK (chequeo_limite_seg BETWEEN 5 AND 300)
);
INSERT INTO comanda_config (idcomanda_config) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS comanda_color (
  idcomanda_color integer PRIMARY KEY DEFAULT nextval('comanda_color_id_seq'),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  desde_minuto integer NOT NULL CHECK (desde_minuto BETWEEN 0 AND 1440),
  color varchar(7) NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT comanda_color_minuto_unico UNIQUE (desde_minuto)
);
INSERT INTO comanda_color (desde_minuto, color)
SELECT v.desde_minuto, v.color FROM (VALUES (0, '#ffffff'), (10, '#fff09a'), (20, '#ffc287'), (30, '#c8ced1'), (40, '#a8d6f4'), (50, '#ffb3b3')) AS v(desde_minuto, color)
WHERE NOT EXISTS (SELECT 1 FROM comanda_color)
ON CONFLICT DO NOTHING;

INSERT INTO usuario_rol_evento (nombre, descripcion, codigo_evento, creado_por) VALUES
  ('Configuración de comanda', 'Acceso a la configuración de la comanda', 'FORM_CONFIGURACION_COMANDA', 'SISTEMA')
ON CONFLICT (codigo_evento) DO NOTHING;

INSERT INTO usuario_rol_item (fk_idusuario_rol, fk_idusuario_rol_evento, creado_por)
SELECT r.idusuario_rol, e.idusuario_rol_evento, 'SISTEMA'
FROM usuario_rol r JOIN usuario_rol_evento e ON e.codigo_evento = 'FORM_CONFIGURACION_COMANDA'
WHERE r.rol IN ('admin', 'encargado')
ON CONFLICT (fk_idusuario_rol, fk_idusuario_rol_evento) DO NOTHING;
