CREATE SEQUENCE IF NOT EXISTS ubicacion_mesa_id_seq;

CREATE TABLE IF NOT EXISTS ubicacion_mesa (
  idubicacion_mesa integer NOT NULL DEFAULT nextval('ubicacion_mesa_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL,
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS ubicacion_mesa_nombre_normalizado_unico
  ON ubicacion_mesa (lower(btrim(nombre)));
CREATE INDEX IF NOT EXISTS ubicacion_mesa_orden_idx
  ON ubicacion_mesa (orden, nombre, idubicacion_mesa);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'mesa'
      AND column_name = 'ubicacion'
  ) THEN
    INSERT INTO ubicacion_mesa (nombre, orden, creado_por)
    SELECT fuente.nombre, row_number() OVER (ORDER BY fuente.primera_mesa)::smallint, 'MIGRACION'
    FROM (
      SELECT COALESCE(NULLIF(btrim(ubicacion), ''), 'Sin ubicación') AS nombre,
             min(idmesa) AS primera_mesa
      FROM mesa
      GROUP BY COALESCE(NULLIF(btrim(ubicacion), ''), 'Sin ubicación')
    ) fuente
    WHERE NOT EXISTS (
      SELECT 1 FROM ubicacion_mesa u
      WHERE lower(btrim(u.nombre)) = lower(btrim(fuente.nombre))
    );
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'mesa'
      AND column_name = 'fk_idubicacion_mesa'
  ) THEN
    ALTER TABLE mesa ADD COLUMN fk_idubicacion_mesa integer;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'mesa'
      AND column_name = 'ubicacion'
  ) THEN
    UPDATE mesa m
    SET fk_idubicacion_mesa = u.idubicacion_mesa
    FROM ubicacion_mesa u
    WHERE lower(btrim(u.nombre)) = lower(COALESCE(NULLIF(btrim(m.ubicacion), ''), 'Sin ubicación'))
      AND m.fk_idubicacion_mesa IS NULL;
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM mesa WHERE fk_idubicacion_mesa IS NULL) THEN
    RAISE EXCEPTION 'No se pudo asignar una ubicación a todas las mesas';
  END IF;
END;
$$;

ALTER TABLE mesa ALTER COLUMN fk_idubicacion_mesa SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mesa_ubicacion_mesa_fk'
  ) THEN
    ALTER TABLE mesa
      ADD CONSTRAINT mesa_ubicacion_mesa_fk
      FOREIGN KEY (fk_idubicacion_mesa)
      REFERENCES ubicacion_mesa(idubicacion_mesa);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS mesa_ubicacion_mesa_idx ON mesa (fk_idubicacion_mesa);
ALTER TABLE mesa DROP COLUMN IF EXISTS ubicacion;

SELECT setval(
  'ubicacion_mesa_id_seq',
  GREATEST(COALESCE((SELECT max(idubicacion_mesa) FROM ubicacion_mesa), 1), 1),
  EXISTS (SELECT 1 FROM ubicacion_mesa)
);
