-- Terminales: cada PC donde se usa el sistema (identificada por el nombre de equipo que informa el agente de impresión)
-- con su impresora de tickets, ancho del papel y saltos en blanco antes del corte.
CREATE TABLE IF NOT EXISTS terminal (
  idterminal serial PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fecha_modificado timestamp,
  modificado_por text,
  equipo text NOT NULL,
  nombre text NOT NULL,
  nombre_impresora text,
  tamano_ticket integer NOT NULL DEFAULT 80 CHECK (tamano_ticket IN (58, 80)),
  saltos_final integer NOT NULL DEFAULT 5 CHECK (saltos_final BETWEEN 0 AND 30),
  impresoras_detectadas text[] NOT NULL DEFAULT '{}',
  version_agente text,
  activo boolean NOT NULL DEFAULT true,
  ultima_conexion timestamp,
  ultimo_usuario text,
  CONSTRAINT terminal_equipo_unico UNIQUE (equipo)
);
