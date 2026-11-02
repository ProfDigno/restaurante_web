-- Cliente rápido: RUC y teléfono pasan a ser opcionales.
-- Los CHECK (btrim(...) <> '') siguen válidos con NULL y los índices únicos admiten varios NULL.
ALTER TABLE cliente ALTER COLUMN ruc DROP NOT NULL;
ALTER TABLE cliente ALTER COLUMN telefono DROP NOT NULL;
