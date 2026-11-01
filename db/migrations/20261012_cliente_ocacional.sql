DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'cliente'
      AND column_name = 'es_ocacional'
  ) THEN
    ALTER TABLE cliente
      ADD COLUMN es_ocacional boolean NOT NULL DEFAULT false;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'cliente_un_ocacional'
  ) THEN
    CREATE UNIQUE INDEX cliente_un_ocacional
      ON cliente (es_ocacional)
      WHERE es_ocacional;
  END IF;
END;
$$;
