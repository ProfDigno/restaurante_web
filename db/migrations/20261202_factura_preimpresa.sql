-- Factura pre-impresa (hoja con triplicado impresa por la impresora local de cada PC) en lugar de la electrónica (SISFE).
-- modo_facturacion elige cómo se emite; las facturas pre-impresas quedan en estado 'emitida' y guardan el total en letras.
-- Cada PC (terminal) tiene una segunda impresora para las facturas. Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'datos_restaurante'::regclass AND attname = 'modo_facturacion' AND NOT attisdropped) THEN
    ALTER TABLE datos_restaurante ADD COLUMN modo_facturacion varchar(12) NOT NULL DEFAULT 'preimpresa'
      CHECK (modo_facturacion IN ('preimpresa', 'electronica'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'factura'::regclass AND attname = 'total_letra' AND NOT attisdropped) THEN
    ALTER TABLE factura ADD COLUMN total_letra text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'terminal'::regclass AND attname = 'impresora_factura' AND NOT attisdropped) THEN
    ALTER TABLE terminal ADD COLUMN impresora_factura text;
  END IF;
END $$;

ALTER TABLE factura DROP CONSTRAINT IF EXISTS factura_estado_check;
ALTER TABLE factura ADD CONSTRAINT factura_estado_check
  CHECK (estado IN ('pendiente', 'borrador', 'enviado', 'aprobado', 'rechazado', 'cancelado', 'error', 'emitida'));
