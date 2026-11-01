DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pago' AND column_name='fk_idpedido') THEN
    ALTER TABLE pago ADD COLUMN fk_idpedido integer REFERENCES pedido(idpedido);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace=(SELECT oid FROM pg_namespace WHERE nspname=current_schema()) AND relname='pago_anticipado_pedido_unico') THEN
    CREATE UNIQUE INDEX pago_anticipado_pedido_unico ON pago (fk_idpedido) WHERE fk_idpedido IS NOT NULL;
  END IF;
END;
$$;
