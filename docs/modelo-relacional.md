# Modelo entidad-relación del restaurante

```mermaid
erDiagram
  USUARIO_ROL ||--o{ USUARIO : asigna
  USUARIO_ROL ||--o{ USUARIO_ROL_ITEM : contiene
  USUARIO_ROL_EVENTO ||--o{ USUARIO_ROL_ITEM : habilita
  ZONA_CLIENTE ||--o{ CLIENTE : clasifica
  MESA ||--o{ CUENTA : ocupa
  CLIENTE ||--o{ CUENTA : identifica
  CUENTA ||--o{ PEDIDO : agrupa
  MESA ||--o{ PEDIDO : recibe
  CLIENTE ||--o{ PEDIDO : solicita
  ENTREGADOR_DELIVERY ||--o{ PEDIDO : entrega
  CATEGORIA_MENU ||--o{ PRODUCTO_MENU : clasifica
  UNIDAD_MENU ||--o{ PRODUCTO_MENU : presenta
  GRUPO_MENU ||--o{ PRODUCTO_MENU : agrupa
  UNIDAD_MEDIDA ||--o{ UNIDAD_CONVERSION : origen
  UNIDAD_MEDIDA ||--o{ UNIDAD_CONVERSION : destino
  UNIDAD_MEDIDA ||--o{ INGREDIENTE : unidad_base
  PRODUCTO_MENU ||--o{ RECETA : compone
  INGREDIENTE ||--o{ RECETA : utiliza
  UNIDAD_MEDIDA ||--o{ RECETA : expresa
  PEDIDO ||--|{ DETALLE_PEDIDO : contiene
  PRODUCTO_MENU ||--o{ DETALLE_PEDIDO : vendido
  DETALLE_PEDIDO ||--o{ DETALLE_PEDIDO_RECETA : congela
  INGREDIENTE ||--o{ DETALLE_PEDIDO_RECETA : conserva
  DETALLE_PEDIDO ||--o{ DETALLE_PEDIDO_INGREDIENTE : personaliza
  INGREDIENTE ||--o{ DETALLE_PEDIDO_INGREDIENTE : seleccionado
  CUENTA ||--o{ PAGO : recibe
  FORMA_PAGO ||--o{ PAGO : utiliza
  PROVEEDOR ||--o{ COMPRA : suministra
  USUARIO ||--o{ COMPRA : registra
  FORMA_PAGO ||--o{ COMPRA : paga
  COMPRA ||--o{ DETALLE_COMPRA : ingredientes
  INGREDIENTE ||--o{ DETALLE_COMPRA : comprado
  UNIDAD_MEDIDA ||--o{ DETALLE_COMPRA : convierte
  COMPRA ||--o{ DETALLE_COMPRA_PRODUCTO : productos
  PRODUCTO_MENU ||--o{ DETALLE_COMPRA_PRODUCTO : comprado
  GASTO_TIPO ||--o{ GASTO : clasifica
  FORMA_PAGO ||--o{ GASTO : paga
  PERSONAL ||--o{ VALE : recibe
  FORMA_PAGO ||--o{ VALE : paga
  CAJA_GRAL ||--o{ CAJA_ARQUEO : concilia
  FORMA_PAGO ||--o{ CAJA_ARQUEO : separa
  CAJA_GRAL ||--o{ CAJA_ITEM : contiene
  FORMA_PAGO ||--o{ CAJA_ITEM : utiliza
  PAGO ||--o{ CAJA_ITEM : origina
  COMPRA ||--o{ CAJA_ITEM : origina
  GASTO ||--o{ CAJA_ITEM : origina
  VALE ||--o{ CAJA_ITEM : origina
  CAJA_ITEM ||--o| CAJA_ITEM : revierte
  INGREDIENTE ||--o{ MOVIMIENTO_STOCK : mueve
  PRODUCTO_MENU ||--o{ MOVIMIENTO_STOCK_PRODUCTO : mueve
  PEDIDO ||--o{ MOVIMIENTO_STOCK : consume
  PEDIDO ||--o{ MOVIMIENTO_STOCK_PRODUCTO : consume
  COMPRA ||--o{ MOVIMIENTO_STOCK : ingresa
  COMPRA ||--o{ MOVIMIENTO_STOCK_PRODUCTO : ingresa
  USUARIO ||--o{ MOVIMIENTO_STOCK : registra
  USUARIO ||--o{ MOVIMIENTO_STOCK_PRODUCTO : registra

  USUARIO_ROL {
    integer idusuario_rol PK
    timestamp fecha_creado
    text creado_por
    varchar rol UK
    boolean activo
  }
  USUARIO_ROL_EVENTO {
    integer idusuario_rol_evento PK
    timestamp fecha_creado
    text creado_por
    varchar nombre
    varchar codigo_evento UK
    boolean activo
  }
  USUARIO_ROL_ITEM {
    integer idusuario_rol_item PK
    timestamp fecha_creado
    text creado_por
    integer fk_idusuario_rol FK
    integer fk_idusuario_rol_evento FK
    boolean activo
  }
  USUARIO {
    integer idusuario PK
    timestamp fecha_creado
    text creado_por
    varchar login UK
    varchar password_hash
    varchar nombre
    integer fk_idusuario_rol FK
    boolean activo
  }
  ZONA_CLIENTE {
    integer idzona_cliente PK
    timestamp fecha_creado
    text creado_por
    varchar codigo UK
    varchar nombre UK
    numeric(14,0) precio_delivery
    boolean activo
  }
  CLIENTE {
    integer idcliente PK
    timestamp fecha_creado
    text creado_por
    integer fk_idzona_cliente FK
    varchar nombre_completo
    varchar razon_social
    varchar ruc UK
    varchar direccion
    varchar telefono
  }
  MESA {
    integer idmesa PK
    timestamp fecha_creado
    text creado_por
    smallint numero UK
    smallint capacidad
    estado_mesa estado
    boolean activa
  }
  CUENTA {
    integer idcuenta PK
    timestamp fecha_creado
    text creado_por
    integer fk_idmesa FK
    integer fk_idcliente FK
    tipo_cuenta tipo
    estado_cuenta estado
    numeric(14,0) total
    numeric(14,0) monto_descuento
    numeric(14,0) monto_recargo
    timestamp fecha_apertura
    timestamp fecha_cierre
    text cerrado_por
  }
  CATEGORIA_MENU {
    integer idcategoria_menu PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    smallint orden
    boolean activa
  }
  UNIDAD_MENU {
    integer idunidad_menu PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    smallint orden
    boolean activo
  }
  GRUPO_MENU {
    integer idgrupo_menu PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    smallint orden
    boolean activo
  }
  UNIDAD_MEDIDA {
    integer idunidad_medida PK
    timestamp fecha_creado
    text creado_por
    varchar codigo UK
    varchar nombre UK
    boolean activo
  }
  UNIDAD_CONVERSION {
    integer idunidad_conversion PK
    timestamp fecha_creado
    text creado_por
    integer fk_idunidad_origen FK
    integer fk_idunidad_destino FK
    numeric(14,0) factor
    boolean activo
  }
  PRODUCTO_MENU {
    integer idproducto_menu PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcategoria_menu FK
    integer fk_idunidad_menu FK
    integer fk_idgrupo_menu FK
    varchar nombre
    numeric(14,0) precio_venta
    numeric(14,0) precio_compra
    numeric(14,0) stock_actual
    numeric(14,0) stock_minimo
    boolean es_descontar_stock
    boolean es_cocina
    boolean es_vender
    boolean es_comprar
  }
  INGREDIENTE {
    integer idingrediente PK
    timestamp fecha_creado
    text creado_por
    integer fk_idunidad_medida FK
    varchar nombre UK
    numeric(14,0) stock_actual
    numeric(14,0) stock_minimo
    numeric(14,0) precio_compra
    numeric(14,0) precio_venta
    boolean activo
  }
  RECETA {
    integer idreceta PK
    timestamp fecha_creado
    text creado_por
    integer fk_idproducto_menu FK
    integer fk_idingrediente FK
    integer fk_idunidad_medida FK
    numeric(14,0) cantidad
  }
  ENTREGADOR_DELIVERY {
    integer identregador_delivery PK
    timestamp fecha_creado
    text creado_por
    varchar nombre_completo
    varchar telefono
    boolean activo
  }
  PEDIDO {
    integer idpedido PK
    timestamp fecha_creado
    text creado_por
    integer fk_idmesa FK
    integer fk_idcuenta FK
    integer fk_idcliente FK
    integer fk_identregador_delivery FK
    tipo_entrega tipo_entrega
    estado_pedido estado
    numeric(14,0) monto_delivery
    numeric(14,0) monto_descuento
    numeric(14,0) monto_recargo
    numeric(14,0) monto_total
    varchar direccion_entrega
    varchar telefono_entrega
    varchar zona_codigo
    varchar zona_nombre
    timestamp fecha_confirmado
    text confirmado_por
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  DETALLE_PEDIDO {
    integer iddetalle_pedido PK
    timestamp fecha_creado
    text creado_por
    integer fk_idpedido FK
    integer fk_idproducto_menu FK
    numeric(14,0) cantidad
    numeric(14,0) precio_venta
    numeric(14,0) precio_compra
    estado_detalle_pedido estado
    boolean usa_receta_stock
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  DETALLE_PEDIDO_RECETA {
    integer iddetalle_pedido_receta PK
    timestamp fecha_creado
    text creado_por
    integer fk_iddetalle_pedido FK
    integer fk_idingrediente FK
    numeric(14,0) cantidad_base
  }
  DETALLE_PEDIDO_INGREDIENTE {
    integer iddetalle_pedido_ingrediente PK
    timestamp fecha_creado
    text creado_por
    integer fk_iddetalle_pedido FK
    integer fk_idingrediente FK
    tipo_modificacion tipo_modificacion
    numeric(14,0) cantidad
    numeric(14,0) precio_venta
    boolean activo
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  FORMA_PAGO {
    integer idforma_pago PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    boolean es_ingreso
    boolean es_egreso
    smallint orden
    boolean activo
  }
  PAGO {
    integer idpago PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcuenta FK
    integer fk_idforma_pago FK
    numeric(14,0) importe
    estado_pago estado
    timestamp pagado_at
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  PROVEEDOR {
    integer idproveedor PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    varchar ruc UK
    varchar direccion
    varchar telefono
    boolean activo
  }
  COMPRA {
    integer idcompra PK
    timestamp fecha_creado
    text creado_por
    integer fk_idproveedor FK
    integer fk_idusuario FK
    integer fk_idforma_pago FK
    estado_compra estado
    estado_pago_compra estado_pago
    timestamp fecha_compra
    numeric(14,0) total
    numeric(14,0) importe_pagado
    timestamp fecha_pago
    text pagado_por
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  DETALLE_COMPRA {
    integer iddetalle_compra PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcompra FK
    integer fk_idingrediente FK
    integer fk_idunidad_medida FK
    numeric(14,0) cantidad
    numeric(14,0) cantidad_base
    numeric(14,0) precio_compra
  }
  DETALLE_COMPRA_PRODUCTO {
    integer iddetalle_compra_producto PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcompra FK
    integer fk_idproducto_menu FK
    numeric(14,0) cantidad
    numeric(14,0) precio_compra
  }
  GASTO_TIPO {
    integer idgasto_tipo PK
    timestamp fecha_creado
    text creado_por
    varchar nombre UK
    smallint orden
    boolean activo
  }
  GASTO {
    integer idgasto PK
    timestamp fecha_creado
    text creado_por
    integer fk_idgasto_tipo FK
    integer fk_idforma_pago FK
    timestamp fecha_gasto
    varchar descripcion
    numeric(14,0) total_gasto
    estado_gasto estado
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  PERSONAL {
    integer idpersonal PK
    timestamp fecha_creado
    text creado_por
    varchar nombre_completo
    varchar documento UK
    numeric(14,0) limite_monto_vale
    boolean activo
  }
  VALE {
    integer idvale PK
    timestamp fecha_creado
    text creado_por
    integer fk_idpersonal FK
    integer fk_idforma_pago FK
    timestamp fecha_vale
    varchar descripcion
    estado_vale estado
    numeric(14,0) monto_vale
    timestamp fecha_anulado
    text anulado_por
    text motivo_anulado
  }
  CAJA_GRAL {
    integer idcaja_gral PK
    timestamp fecha_creado
    text creado_por
    timestamp fecha_apertura
    timestamp fecha_cierre
    text cerrado_por
    estado_caja_gral estado
  }
  CAJA_ARQUEO {
    integer idcaja_arqueo PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcaja_gral FK
    integer fk_idforma_pago FK
    numeric(14,0) monto_inicial
    numeric(14,0) total_ingresos
    numeric(14,0) total_egresos
    numeric(14,0) monto_esperado
    numeric(14,0) monto_contado
    numeric(14,0) diferencia
  }
  CAJA_ITEM {
    integer idcaja_item PK
    timestamp fecha_creado
    text creado_por
    integer fk_idcaja_gral FK
    integer fk_idforma_pago FK
    tipo_movimiento_caja tipo_movimiento
    text descripcion
    numeric(14,0) monto_pago
    numeric(14,0) monto_compra
    numeric(14,0) monto_gasto
    numeric(14,0) monto_vale
    integer fk_idpago FK
    integer fk_idcompra FK
    integer fk_idgasto FK
    integer fk_idvale FK
    boolean es_reversion
    integer fk_idcaja_item_origen FK
  }
  MOVIMIENTO_STOCK {
    integer idmovimiento_stock PK
    timestamp fecha_creado
    text creado_por
    integer fk_idingrediente FK
    integer fk_idusuario FK
    integer fk_idcompra FK
    integer fk_idpedido FK
    integer fk_idunidad_medida FK
    tipo_movimiento_stock tipo
    numeric(14,0) cantidad
    numeric(14,0) cantidad_origen
    numeric(14,0) costo_unitario
  }
  MOVIMIENTO_STOCK_PRODUCTO {
    integer idmovimiento_stock_producto PK
    timestamp fecha_creado
    text creado_por
    integer fk_idproducto_menu FK
    integer fk_idusuario FK
    integer fk_idcompra FK
    integer fk_idpedido FK
    tipo_movimiento_stock tipo
    numeric(14,0) cantidad
    numeric(14,0) costo_unitario
  }
```

Todas las tablas físicas mantienen el orden obligatorio `id`, `fecha_creado`,
`creado_por`. La vista `vista_detalle_pedido` presenta el producto y sus modificaciones
`(Agre)` y `(Sin)` como líneas consecutivas. Las personalizaciones no modifican stock.

El inventario de recetas se congela en `detalle_pedido_receta` al confirmar, por lo que un
cambio posterior en la receta no altera pedidos históricos. `caja_item` es inmutable y las
anulaciones se registran como movimientos compensatorios conciliados en `caja_arqueo`.
# Convenciones de importes

Todas las columnas numéricas del modelo usan `numeric(14,0)`: no se aceptan decimales. Los valores monetarios están expresados en Guaraní paraguayo (`PYG`).
# Extensión de pedidos web

- `pedido.version_web integer`: control de edición concurrente. COCINA se presenta desde
  `en_preparacion`; TERMINADO corresponde a `listo`. El cobro no representa entrega física.
- `devolucion_pago`: `iddevolucion_pago integer` con secuencia, `fecha_creado timestamp`,
  `creado_por text`, `fk_idpedido integer`, `fk_idpago integer`, `importe numeric(14,0)`
  positivo y `motivo text` obligatorio. Pedido y pago tienen relaciones uno a muchos con
  esta tabla. Cada devolución utiliza la forma del pago original y es inmutable.
- `caja_item.fk_iddevolucion_pago`: relación única opcional a la devolución; conserva también
  `fk_idpago` y `fk_idcaja_item_origen`. Usa `monto_pago`, tipo egreso y `es_reversion=true`.
  Un cobro admite varias devoluciones parciales, limitadas por su importe disponible.
- `operacion_web`: ID entero con secuencia, auditoría, `clave` única, `solicitud jsonb` y
  `respuesta jsonb`. Registra resultados confirmados para evitar duplicar operaciones.
- Cobrado neto de cuenta: pagos aprobados menos devoluciones. Una validación diferida
  comprueba el saldo al finalizar cada transacción, también al anular pedidos históricos.
  La cuenta cerrada permanece cerrada y conserva su fecha/responsable de cierre.
