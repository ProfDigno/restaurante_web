-- Forma de pago por defecto: una única forma activa (hoy EFECTIVO) que usan Caja y los cobros.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'forma_pago' AND column_name = 'es_default'
  ) THEN
    ALTER TABLE forma_pago ADD COLUMN es_default boolean NOT NULL DEFAULT false;
    UPDATE forma_pago SET es_default = true
    WHERE idforma_pago = (SELECT idforma_pago FROM forma_pago WHERE activo AND upper(btrim(nombre)) = 'EFECTIVO' ORDER BY idforma_pago LIMIT 1);
  END IF;
END;
$$;
CREATE UNIQUE INDEX IF NOT EXISTS forma_pago_unica_default ON forma_pago (es_default) WHERE es_default;
