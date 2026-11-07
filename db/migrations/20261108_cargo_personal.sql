-- Cargos del personal como catálogo (RR.HH.): evita duplicados como "Cocinera", "COCINERA" y "cocinera ".
-- El nombre se guarda sin espacios sobrantes y es único sin distinguir mayúsculas.
-- Pasa los cargos escritos a mano a la tabla (unificando duplicados con la grafía más usada; en empate,
-- la que empieza con mayúscula),
-- vincula a cada persona y elimina la columna de texto. Compatible con PostgreSQL 9.5 e idempotente.
CREATE SEQUENCE IF NOT EXISTS cargo_personal_id_seq;
CREATE TABLE IF NOT EXISTS cargo_personal (
  idcargo_personal integer NOT NULL DEFAULT nextval('cargo_personal_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  nombre varchar(80) NOT NULL CONSTRAINT cargo_personal_nombre_limpio CHECK (nombre <> '' AND nombre = btrim(nombre) AND nombre !~ '\s{2,}'),
  orden smallint NOT NULL DEFAULT 0 CHECK (orden >= 0),
  activo boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX IF NOT EXISTS cargo_personal_nombre_unico ON cargo_personal (lower(nombre));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='personal' AND column_name='fk_idcargo_personal') THEN
    ALTER TABLE personal ADD COLUMN fk_idcargo_personal integer REFERENCES cargo_personal(idcargo_personal);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='personal' AND column_name='cargo') THEN
    INSERT INTO cargo_personal (nombre, orden, creado_por)
    SELECT x.nombre, (row_number() OVER (ORDER BY x.clave))::smallint, 'MIGRACION'
    FROM (
      SELECT DISTINCT ON (t.clave) t.clave, t.nombre
      FROM (
        SELECT lower(regexp_replace(btrim(cargo), '\s+', ' ', 'g')) AS clave,
               regexp_replace(btrim(cargo), '\s+', ' ', 'g') AS nombre, count(*) AS veces
        FROM personal WHERE btrim(COALESCE(cargo, '')) <> '' GROUP BY 1, 2
      ) t ORDER BY t.clave, t.veces DESC, (t.nombre ~ '^[[:upper:]]') DESC, t.nombre
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM cargo_personal c WHERE lower(c.nombre) = x.clave);
    UPDATE personal p SET fk_idcargo_personal = c.idcargo_personal
    FROM cargo_personal c
    WHERE p.fk_idcargo_personal IS NULL AND lower(c.nombre) = lower(regexp_replace(btrim(p.cargo), '\s+', ' ', 'g'));
    ALTER TABLE personal DROP COLUMN cargo;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS personal_cargo_idx ON personal (fk_idcargo_personal);
