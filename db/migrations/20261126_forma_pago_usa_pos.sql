-- Forma de pago que se cobra con la máquina de tarjeta (POS).
ALTER TABLE forma_pago ADD COLUMN IF NOT EXISTS usa_pos boolean NOT NULL DEFAULT false;
