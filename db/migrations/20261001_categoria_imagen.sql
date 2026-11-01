DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'categoria_menu'
      AND column_name = 'imagen_url'
  ) THEN
    ALTER TABLE categoria_menu ADD COLUMN imagen_url text;
  END IF;
END $$;
