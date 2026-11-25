-- Acceso propio del entregador de delivery: usuario y PIN de 4 números (hash bcrypt, como en usuario).
-- Ambos son opcionales: un entregador sin usuario simplemente no puede ingresar.
-- El usuario se guarda sin espacios y es único sin distinguir mayúsculas. Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='entregador_delivery' AND column_name='usuario') THEN
    ALTER TABLE entregador_delivery ADD COLUMN usuario varchar(50)
      CONSTRAINT entregador_delivery_usuario_limpio CHECK (usuario IS NULL OR (usuario <> '' AND usuario !~ '\s'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='entregador_delivery' AND column_name='password_hash') THEN
    ALTER TABLE entregador_delivery ADD COLUMN password_hash varchar(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='entregador_delivery_acceso_completo' AND conrelid='entregador_delivery'::regclass) THEN
    ALTER TABLE entregador_delivery ADD CONSTRAINT entregador_delivery_acceso_completo
      CHECK ((usuario IS NULL) = (password_hash IS NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS entregador_delivery_usuario_unico ON entregador_delivery (lower(usuario)) WHERE usuario IS NOT NULL;
