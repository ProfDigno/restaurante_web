-- Rendición del entregador: control del cierre de la máquina POS.
-- Si la rendición tiene cobros con formas que usan POS, se registra la máquina, el monto de su resumen impreso
-- (pos_informado) y lo que dice el sistema (pos_sistema); la diferencia se informa pero no bloquea.
-- Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='rendicion_delivery' AND column_name='fk_idmaquina_pos') THEN
    ALTER TABLE rendicion_delivery ADD COLUMN fk_idmaquina_pos integer REFERENCES maquina_pos(idmaquina_pos);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='rendicion_delivery' AND column_name='pos_sistema') THEN
    ALTER TABLE rendicion_delivery ADD COLUMN pos_sistema numeric(14,0) NOT NULL DEFAULT 0 CHECK (pos_sistema >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='rendicion_delivery' AND column_name='pos_informado') THEN
    ALTER TABLE rendicion_delivery ADD COLUMN pos_informado numeric(14,0) CHECK (pos_informado >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rendicion_delivery_pos_valido') THEN
    ALTER TABLE rendicion_delivery ADD CONSTRAINT rendicion_delivery_pos_valido CHECK ((fk_idmaquina_pos IS NULL) = (pos_informado IS NULL));
  END IF;
END $$;
