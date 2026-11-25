-- Rendición del entregador: al final del turno se cobra cada pedido que llevó (efectivo, tarjeta, QR…)
-- y se le paga su delivery en efectivo (pago_delivery + gasto "Pago a delivery"). El neto es lo que
-- entrega en mano: efectivo cobrado − delivery (si es negativo, el local le paga la diferencia).
-- Un pedido solo puede estar en una rendición activa. Compatible con PostgreSQL 9.5 e idempotente.
CREATE SEQUENCE IF NOT EXISTS rendicion_delivery_id_seq;
CREATE TABLE IF NOT EXISTS rendicion_delivery (
  idrendicion_delivery integer NOT NULL DEFAULT nextval('rendicion_delivery_id_seq'::regclass) PRIMARY KEY,
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  fk_identregador_delivery integer NOT NULL REFERENCES entregador_delivery(identregador_delivery),
  cantidad_pedidos integer NOT NULL CHECK (cantidad_pedidos > 0),
  efectivo_cobrado numeric(14,0) NOT NULL DEFAULT 0 CHECK (efectivo_cobrado >= 0),
  otros_cobrado numeric(14,0) NOT NULL DEFAULT 0 CHECK (otros_cobrado >= 0),
  delivery_pagado numeric(14,0) NOT NULL DEFAULT 0 CHECK (delivery_pagado >= 0),
  -- Positivo: lo entrega el entregador. Negativo: se lo paga el local.
  neto numeric(14,0) NOT NULL,
  -- Pago del delivery de esta rendición (NULL si no había delivery por pagar).
  fk_idpago_delivery integer UNIQUE REFERENCES pago_delivery(idpago_delivery),
  estado varchar(10) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'anulada')),
  fecha_anulado timestamp, anulado_por text, motivo_anulado text,
  CONSTRAINT rendicion_delivery_neto_valido CHECK (neto = efectivo_cobrado - delivery_pagado),
  CONSTRAINT rendicion_delivery_pago_valido CHECK ((delivery_pagado = 0) = (fk_idpago_delivery IS NULL)),
  CONSTRAINT rendicion_delivery_anulacion_valida CHECK (
    (estado = 'anulada' AND fecha_anulado IS NOT NULL AND anulado_por IS NOT NULL AND motivo_anulado IS NOT NULL) OR
    (estado = 'activa' AND fecha_anulado IS NULL AND anulado_por IS NULL AND motivo_anulado IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS rendicion_delivery_entregador_idx ON rendicion_delivery (fk_identregador_delivery, fecha_creado DESC);

CREATE TABLE IF NOT EXISTS rendicion_delivery_pedido (
  fk_idrendicion_delivery integer NOT NULL REFERENCES rendicion_delivery(idrendicion_delivery),
  fk_idpedido integer NOT NULL REFERENCES pedido(idpedido),
  total_pedido numeric(14,0) NOT NULL CHECK (total_pedido >= 0),
  -- Lo que el cliente ya había pagado antes (p. ej. transferencia o pago anticipado): no lo trae el entregador.
  cobrado_antes numeric(14,0) NOT NULL DEFAULT 0 CHECK (cobrado_antes >= 0),
  cobrado_efectivo numeric(14,0) NOT NULL DEFAULT 0 CHECK (cobrado_efectivo >= 0),
  cobrado_otros numeric(14,0) NOT NULL DEFAULT 0 CHECK (cobrado_otros >= 0),
  formas_cobro text,
  -- Delivery que se le pagó en esta rendición (0 si ya se le había pagado antes o el pedido no tenía).
  delivery_pagado numeric(14,0) NOT NULL DEFAULT 0 CHECK (delivery_pagado >= 0),
  activo boolean NOT NULL DEFAULT true,
  PRIMARY KEY (fk_idrendicion_delivery, fk_idpedido)
);
CREATE UNIQUE INDEX IF NOT EXISTS rendicion_delivery_pedido_unico ON rendicion_delivery_pedido (fk_idpedido) WHERE activo;
