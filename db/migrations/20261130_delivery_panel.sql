-- Panel del entregador (/delivery): forma de pago que el entregador indica para el pedido.
-- Es solo informativa (no mueve la caja); la Rendición la propone como forma de cobro. Compatible con PostgreSQL 9.5 e idempotente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pedido' AND column_name='fk_idforma_pago_entrega') THEN
    ALTER TABLE pedido ADD COLUMN fk_idforma_pago_entrega integer REFERENCES forma_pago(idforma_pago);
  END IF;
END $$;
