-- Pagos a delivery: "marcar como ya pagado" sin mover la caja (delivery que se pagó fuera del sistema).
-- Un pago sin caja no tiene gasto ni forma de pago y exige una observación. Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pago_delivery' AND column_name='sin_caja') THEN
    ALTER TABLE pago_delivery ADD COLUMN sin_caja boolean NOT NULL DEFAULT false;
    ALTER TABLE pago_delivery ADD COLUMN observacion text;
    ALTER TABLE pago_delivery ALTER COLUMN fk_idgasto DROP NOT NULL;
    ALTER TABLE pago_delivery ALTER COLUMN fk_idforma_pago DROP NOT NULL;
    ALTER TABLE pago_delivery ADD CONSTRAINT pago_delivery_origen_valido CHECK (
      (NOT sin_caja AND fk_idgasto IS NOT NULL AND fk_idforma_pago IS NOT NULL) OR
      (sin_caja AND fk_idgasto IS NULL AND fk_idforma_pago IS NULL AND btrim(COALESCE(observacion, '')) <> ''));
  END IF;
END $$;
