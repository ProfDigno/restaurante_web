-- Auditoría de acciones sensibles: quién, cuándo, desde qué IP, qué cambió (antes/después) y por qué.
-- Solo se agregan filas; un trigger impide modificarlas o borrarlas. Compatible con PostgreSQL 9.5.
CREATE TABLE IF NOT EXISTS auditoria (
  idauditoria bigserial PRIMARY KEY,
  fecha timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fk_idusuario integer REFERENCES usuario(idusuario),
  usuario_login text NOT NULL,
  ip varchar(64),
  accion varchar(60) NOT NULL,
  entidad varchar(40) NOT NULL,
  id_entidad integer,
  antes jsonb,
  despues jsonb,
  motivo text
);
CREATE INDEX IF NOT EXISTS auditoria_fecha_idx ON auditoria (fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_accion_fecha_idx ON auditoria (accion, fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_usuario_fecha_idx ON auditoria (usuario_login, fecha DESC);
CREATE INDEX IF NOT EXISTS auditoria_entidad_idx ON auditoria (entidad, id_entidad);

CREATE OR REPLACE FUNCTION auditoria_inmutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría no se puede modificar ni borrar';
END;
$$;
DROP TRIGGER IF EXISTS auditoria_inmutable_fila ON auditoria;
CREATE TRIGGER auditoria_inmutable_fila BEFORE UPDATE OR DELETE ON auditoria
  FOR EACH ROW EXECUTE PROCEDURE auditoria_inmutable();
DROP TRIGGER IF EXISTS auditoria_inmutable_truncate ON auditoria;
CREATE TRIGGER auditoria_inmutable_truncate BEFORE TRUNCATE ON auditoria
  FOR EACH STATEMENT EXECUTE PROCEDURE auditoria_inmutable();
