-- Ticket de comanda: si cada PC lo imprime detrás del ticket de pedido, y el valor por defecto para las demás.
-- Arranca desactivado. Compatible con PostgreSQL 9.5 (sin ADD COLUMN IF NOT EXISTS) e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'impresora_config'::regclass AND attname = 'imprime_comanda' AND NOT attisdropped) THEN
    ALTER TABLE impresora_config ADD COLUMN imprime_comanda boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'terminal'::regclass AND attname = 'imprime_comanda' AND NOT attisdropped) THEN
    ALTER TABLE terminal ADD COLUMN imprime_comanda boolean NOT NULL DEFAULT false;
  END IF;
END $$;
