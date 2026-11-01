# Restaurante Web — mesas, cuentas, pedidos y menú

El esquema es compatible con PostgreSQL 9.5 o superior. En PostgreSQL 9.5 los IDs
autoincrementales se implementan mediante secuencias `nextval()` equivalentes a
`GENERATED ALWAYS AS IDENTITY`.

## Usuarios, roles y permisos

`usuario` usa `login`, `nombre` y `password_hash`, y puede asociarse a un único
`usuario_rol` mediante `fk_idusuario_rol`. Los permisos configurables se almacenan
en `usuario_rol_evento` y se asignan mediante `usuario_rol_item`.

`compra` separa recepción y pago. La recepción actualiza inventario; `pagar_compra(...)`
registra un único pago por el total completo y genera automáticamente el egreso de caja.
La forma de pago es opcional mientras la compra está en borrador o pendiente de pago.

En todas las tablas, las primeras columnas siguen siempre el orden `id...`,
`fecha_creado` y `creado_por`; después se declaran las columnas funcionales.

Los gastos se clasifican mediante `gasto_tipo` y se registran en `gasto`, relacionado
con `forma_pago` mediante `fk_idforma_pago`. El importe se almacena en `total_gasto`
y las anulaciones conservan `fecha_anulado` y `anulado_por`.

## Caja general

La caja se abre con saldos iniciales por forma de pago y solo puede existir una caja abierta:

```sql
SELECT abrir_caja_gral(jsonb_build_object(:id_efectivo::text, 10000), 'caja');
```

`caja_item` se genera automáticamente al aprobar pagos o marcar compras, gastos y vales
como pagados. Mantiene la forma de pago, una descripción y una relación directa con su origen.
El importe se guarda en la columna específica según el origen: `monto_pago`,
`monto_compra`, `monto_gasto` o `monto_vale`. Las anulaciones generan movimientos
compensatorios y nunca eliminan el movimiento original. El arqueo se guarda por forma de
pago en `caja_arqueo`:

```sql
SELECT cerrar_caja_gral(
  :idcaja_gral,
  jsonb_build_object(:id_efectivo::text, :monto_contado_efectivo),
  'caja'
);
```

Para aprobar o pagar una operación debe existir una caja abierta. El sistema calcula por
cada forma `monto_esperado = monto_inicial + ingresos - egresos` y guarda la diferencia.

```sql
SELECT u.login, u.nombre, r.rol, e.codigo_evento
FROM usuario u
LEFT JOIN usuario_rol r ON r.idusuario_rol = u.fk_idusuario_rol
LEFT JOIN usuario_rol_item i ON i.fk_idusuario_rol = r.idusuario_rol AND i.activo
LEFT JOIN usuario_rol_evento e ON e.idusuario_rol_evento = i.fk_idusuario_rol_evento AND e.activo;
```

## Catálogo de menú

`producto_menu` se relaciona con `categoria_menu`, `grupo_menu` y `unidad_menu`.
Además contiene `precio_venta`, `precio_compra`, `orden`, stock y flags operativos:
`activo`, `es_descontar_stock`, `es_cocina`, `es_vender` y `es_comprar`.

`es_vender = false` impide agregar el producto a nuevos pedidos. Al crear un detalle,
el sistema copia automáticamente `precio_venta` y `precio_compra` desde el producto.

`ingrediente` mantiene `precio_compra` como referencia actual de adquisición y
`precio_venta` como precio sugerido para personalizaciones agregadas. Cada línea de
compra usa `detalle_compra.precio_compra`; al recibirla, ese valor actualiza el
precio referencial del ingrediente y se conserva como `movimiento_stock.costo_unitario`.

`unidad_medida` y `unidad_conversion` normalizan las cantidades de recetas y compras a la
unidad base del ingrediente. Los productos directos se compran mediante
`detalle_compra_producto` y conservan historial en `movimiento_stock_producto`.

Los productos con receta descuentan ingredientes al confirmar el pedido. Los productos sin
receta descuentan su propio stock. Las modificaciones posteriores generan únicamente la
diferencia necesaria y las anulaciones restauran el stock.

## Personalización de ingredientes

Cada `detalle_pedido` puede tener ingredientes agregados o quitados en
`detalle_pedido_ingrediente`. Un ingrediente `AGREGAR` puede tener precio y suma al
pedido; un ingrediente `QUITAR` siempre tiene precio cero. Estas personalizaciones no
modifican la receta base ni el stock.
La cantidad del ingrediente corresponde a cada unidad del producto. El cargo de
`AGREGAR` es el precio de venta del ingrediente multiplicado por la cantidad del
producto padre; `QUITAR` no suma importe.

Para mostrar el producto y sus personalizaciones como filas consecutivas se utiliza
`vista_detalle_pedido`:

```sql
SELECT idpedido, iddetalle_pedido, tipo_linea, descripcion, cantidad, precio
FROM vista_detalle_pedido
WHERE idpedido = :idpedido
ORDER BY iddetalle_pedido, orden_linea, iddetalle_pedido_ingrediente;
```

La vista muestra el producto principal, luego `(Agre)` para ingredientes agregados y
`(Sin)` para ingredientes quitados.

## Clientes y delivery

`cliente` puede almacenar `razon_social`, `ruc`, `direccion`, `telefono` y una zona mediante
`fk_idzona_cliente`. `zona_cliente` define `codigo`, `nombre` y `precio_delivery`.

Toda venta tiene una `cuenta`. Los pedidos `DELIVERY` y `BUSCAR` crean automáticamente una
cuenta sin mesa mediante `crear_pedido_externo(...)`. Un delivery conserva una copia
histórica de dirección, teléfono, zona y precio de entrega, aunque luego cambie el cliente.

## Flujo de salón

1. La mesa comienza en estado `libre`.
2. `abrir_cuenta_mesa(...)` crea una cuenta y cambia la mesa a `ocupado`.
3. Todos los pedidos de salón se vinculan con la misma mesa y cuenta.
4. La cuenta suma pedidos, delivery y agregados, aplicando descuentos y recargos.
5. Se pueden registrar múltiples pagos parciales en `pago`.
6. `cerrar_cuenta_mesa(...)` exige pago exacto y pedidos entregados o cancelados; luego
   cierra la cuenta y devuelve la mesa a `libre`.

## Instalación

```bash
createdb bdrestaurante_web
psql bdrestaurante_web -f db/schema.sql
psql bdrestaurante_web -f db/seed.sql
npm run db:migrate-categoria-imagen
npm run db:migrate-producto-menu-ingrediente
npm run db:migrate-producto-ingrediente-cantidad-entera
npm run db:migrate-pedido-ingredientes
npm run db:migrate-pedido-entregador-delivery
```

En bases ya instaladas, ejecutá `npm run db:migrate-producto-menu-ingrediente` una vez para habilitar la lista informativa de ingredientes de los productos del menú.
Luego ejecutá `npm run db:migrate-producto-ingrediente-cantidad-entera` para usar cantidades enteras. La migración se detiene si encuentra alguna cantidad fraccionaria.
Ejecutá `npm run db:migrate-pedido-ingredientes` para calcular las personalizaciones del pedido según la cantidad del producto padre.
Ejecutá `npm run db:migrate-pedido-entregador-delivery` en bases instaladas para permitir cambios en pedidos con un entregador posteriormente desactivado.

## Aplicación Node.js

La aplicación utiliza Express para la API, React/Vite para la interfaz y `pg` para
conectarse a PostgreSQL. Copiá `.env.example` como `.env` y completá `DB_PASSWORD`
antes de iniciar.

```bash
npm install
npm run dev
```

También podés ejecutar `iniciar_restaurante.bat` desde Windows. El script verifica
Node.js, instala dependencias faltantes y levanta backend y frontend sin recrear la base.

URL local única:

- Aplicación e interfaz: `http://localhost:3000`
- API: `http://localhost:3000/api`
- Salud: `http://localhost:3000/api/health`

Usuarios demo iniciales:

```text
admin / admin
encargado / encargado
mozo / mozo
```

Las contraseñas demo deben reemplazarse antes de utilizar el sistema en producción.

Las categorías pueden tener una imagen opcional JPEG, PNG o WebP de hasta 5 MB.
La API recibe el archivo como `image` mediante `multipart/form-data`; los archivos
se guardan localmente en `uploads/categorias` y se sirven desde `/uploads`. Esa
carpeta está excluida del control de versiones y debe incluirse en las copias de
seguridad del servidor.

## Ejemplos

```sql
-- Abrir mesa.
SELECT abrir_cuenta_mesa(:fk_idmesa, :fk_idcliente, 'mozo');

-- Pedido de salón acumulado en la cuenta.
INSERT INTO pedido (fk_idmesa, fk_idcuenta, tipo_entrega, creado_por)
VALUES (:fk_idmesa, :fk_idcuenta, 'COMER_ACA', 'mozo');

-- Pedido para llevar: crea una cuenta sin mesa.
SELECT crear_pedido_externo('BUSCAR', :fk_idcliente, 'Retira en mostrador', 'mozo');

-- Pedido DELIVERY con cuenta y datos históricos de entrega.
SELECT crear_pedido_externo('DELIVERY', :fk_idcliente, 'Entregar en recepción', 'mozo');

-- Confirmar y descontar inventario una sola vez.
SELECT confirmar_pedido(:idpedido, :idusuario, 'mozo');

-- Personalizar un detalle.
INSERT INTO detalle_pedido_ingrediente
  (fk_iddetalle_pedido, fk_idingrediente, tipo_modificacion, cantidad, precio_venta, creado_por)
VALUES (:fk_iddetalle_pedido, :fk_idingrediente, 'AGREGAR', 1, 500, 'mozo');
INSERT INTO detalle_pedido_ingrediente
  (fk_iddetalle_pedido, fk_idingrediente, tipo_modificacion, cantidad, precio_venta, creado_por)
VALUES (:fk_iddetalle_pedido, :fk_idingrediente, 'QUITAR', 1, 0, 'mozo');

-- Consultar total y cerrar cuando esté pagado.
SELECT calcular_total_cuenta(:idcuenta);
INSERT INTO pago (fk_idcuenta, fk_idforma_pago, importe, estado, creado_por)
VALUES (:idcuenta, :fk_idforma_pago, :importe, 'aprobado', 'caja');
SELECT cerrar_cuenta_mesa(:idcuenta, 'caja');
```

## Pruebas

```bash
createdb restaurante_test
psql restaurante_test -f db/schema.sql
psql restaurante_test -f db/seed.sql
psql restaurante_test -f db/tests.sql
dropdb restaurante_test
```

Las pruebas cubren cuentas de salón y externas, pagos parciales, sobrepagos, delivery
histórico, conversiones, inventario diferencial, compras, anulaciones, caja automática,
reversiones, arqueo por forma y protección del historial.

## Grupo de menú

Desde la opción **Catálogo → Grupos de menú** se administra el catálogo con buscador, paginación de 25/50/100 registros, activación directa y edición en una ventana emergente. El botón **Nuevo grupo** abre el formulario; la fecha de creación y el usuario creador se muestran al seleccionar una fila.

La API protegida está disponible en `GET /api/grupos-menu`, `POST /api/grupos-menu` y `PUT /api/grupos-menu/:id` para usuarios con rol `admin` o `encargado`.
# Valores numéricos y moneda

Todos los importes, precios, cantidades, stocks y conversiones se manejan como enteros en PostgreSQL (`numeric(14,0)`). La aplicación utiliza Guaraní paraguayo (`PYG`) sin decimales y alinea los valores numéricos a la derecha. Los formularios rechazan valores negativos o con decimales.
# Pedidos, cuentas y formas de pago

La pantalla **Operación → Pedidos** permite filtrar por categoría y unidad, buscar productos,
seleccionar cliente y cargar cantidades, delivery, descuento en PYG y observaciones.
Desde una mesa ocupada, **Ver cuenta / Pedidos** muestra sus pedidos y saldo consolidado.

1. **Nuevo pedido**: cliente inicial ID 1 (si existe y está activo). Seleccionar mesa para
   COMER_ACA; BUSCAR y DELIVERY generan una cuenta propia. Delivery exige dirección,
   teléfono y zona activa; una tarifa cero es válida.
2. **Guardar pedido**: registra la venta y consume stock en una transacción. El estado
   visible COCINA corresponde a `en_preparacion`. Los detalles pueden editarse hasta terminar.
   Tipo, mesa y cliente quedan fijos después del guardado; los precios históricos se conservan.
3. **TERMINAR**: cambia a `listo` (TERMINADO), sin cobrar ni marcar una entrega física.
4. **Ver cuenta / Cobrar**: admin y encargado pueden ingresar pagos parciales o múltiples
   formas cuando todos los pedidos están terminados. Efectivo se selecciona inicialmente
   si está disponible. No se admiten sobrepagos. El saldo cero cierra la cuenta y libera la
   mesa; una cortesía total se cierra sin insertar pagos ficticios.
5. **ANULAR**: admin/encargado indican motivo. Se cancela únicamente ese pedido. Si los
   pagos netos exceden el nuevo total, deben distribuir la devolución exacta entre los pagos
   originales, sin exceder lo disponible de cada uno. Se conserva el historial y se revierte
   stock. Una cuenta histórica no reabre ni altera una ocupación posterior de la mesa.

**Caja y finanzas → Caja general** permite consultar y abrir caja con saldos iniciales
por forma de pago. Se exige caja abierta para cobrar o devolver dinero. Esta pantalla no
incluye todavía el arqueo/cierre completo. **Formas de pago** tiene búsqueda, paginación,
alta/edición en modal, activación, banderas ingreso/egreso y flechas de orden.

## Instalación de esta actualización

Conservar `.env` con la conexión existente. No recrear `bdrestaurante_web` ni ejecutar
el esquema completo sobre ella. Aplicar la migración aditiva una vez:

```powershell
node db/migrate-pedidos.js
pnpm run build
pnpm run server
```

Detener primero el servidor anterior si ya ocupa el puerto 3000. Para instalaciones nuevas,
`db/schema.sql` incluye la actualización y `db/seed.sql` conserva los catálogos iniciales.
La migración es compatible con PostgreSQL 9.5 y mantiene secuencias enteras.

## API de pedidos

- `GET /api/pedidos`: búsqueda, estado y paginación.
- `GET /api/pedidos/catalogo`: categoría, unidad, búsqueda y paginación; acceso operativo para mozos.
- `GET /api/pedidos/clientes`: búsqueda por nombre/RUC/teléfono o ID exacto.
- `POST /api/pedidos`, `GET/PUT /api/pedidos/:id`, `POST /api/pedidos/:id/terminar`.
- `GET /api/pedidos/cuentas/:id`, `POST /api/pedidos/cuentas/:id/cobrar`.
- `GET /api/pedidos/:id/anulacion`: vista previa del nuevo total y devolución necesaria.
- `POST /api/pedidos/:id/anular`: motivo y distribución de devoluciones.
- `GET /api/pedidos/caja`, `POST /api/pedidos/caja/abrir`.
- `GET/POST /api/formas-pago`, `PUT /api/formas-pago/:id`, `POST /api/formas-pago/:id/orden`.

Las escrituras nuevas requieren `clave` (UUID de operación) en el JSON. Un reintento con
la misma clave y contenido devuelve el resultado ya confirmado; contenido distinto da 409.
La edición y finalización de pedidos requieren `version_web` para detectar cambios simultáneos. El servidor
obtiene precios, recalcula totales, rechaza fracciones y valida roles; nunca confía en un total
calculado por el navegador. Devoluciones y pagos originales son registros separados.

## Pruebas de pedidos

```powershell
pnpm run test:pedidos
```

`db/test-pedidos-web.js` prueba el flujo transaccional en la base configurada y revierte
sus datos al terminar (las secuencias pueden dejar huecos). `db/test-pedidos-http.js` instala
el esquema y semillas en un esquema temporal exclusivo, prueba API, permisos y concurrencia,
y elimina únicamente ese esquema al terminar. No cambia registros de trabajo.
Las personalizaciones AGREGAR/QUITAR y el cierre completo de caja quedan fuera de esta interfaz.
