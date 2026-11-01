CREATE TABLE IF NOT EXISTS producto_menu_ingrediente (
  fk_idproducto_menu integer NOT NULL REFERENCES producto_menu(idproducto_menu) ON DELETE CASCADE,
  fk_idingrediente integer NOT NULL REFERENCES ingrediente(idingrediente),
  cantidad numeric(14,3) NOT NULL CHECK (cantidad > 0),
  fecha_creado timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  creado_por text NOT NULL DEFAULT 'SISTEMA',
  PRIMARY KEY (fk_idproducto_menu, fk_idingrediente)
);
