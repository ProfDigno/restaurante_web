DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM producto_menu_ingrediente
    WHERE cantidad <> trunc(cantidad)
  ) THEN
    RAISE EXCEPTION 'Hay cantidades fraccionarias en producto_menu_ingrediente; corregilas antes de migrar';
  END IF;
END $$;

ALTER TABLE producto_menu_ingrediente
  ALTER COLUMN cantidad TYPE numeric(14,0)
  USING cantidad::numeric(14,0);
