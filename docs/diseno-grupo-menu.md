# Diseño: Grupo de menú

## Objetivo

Pantalla para administrar los grupos del menú del restaurante, permitiendo consultar, crear, editar, activar, desactivar y reordenar los grupos.

## Estructura de la pantalla

### Encabezado

- Sección: `CATÁLOGO`.
- Título: `Grupos de menú`.
- Descripción: `Organizá los productos por grupos como Comida, Bebida o Postre.`.
- Botón principal: `+ Nuevo grupo`.

### Barra de herramientas

- Buscador por nombre.
- Etiqueta de auditoría del grupo seleccionado:
  - Nombre del grupo.
  - Fecha de creación.
  - Usuario que lo creó.
- Contador de resultados:
  - `1 grupo`.
  - `N grupos`.

La información de auditoría cambia cuando se selecciona otra fila.

## Tabla

La tabla contiene cuatro columnas:

| Columna | Descripción |
|---|---|
| Nombre | Nombre del grupo e identificador interno. |
| Orden | Número de posición y flechas para subir o bajar. |
| Estado | Interruptor para activar o desactivar el grupo. |
| Acciones | Botón `Editar`. |

### Estado activo e inactivo

- Grupo activo: se muestra normalmente y el interruptor queda activado.
- Grupo inactivo: el texto se muestra en rojo y tachado; el interruptor queda desactivado.
- La activación o desactivación se guarda directamente desde la tabla.

### Ordenamiento

- La tabla se muestra ordenada por el campo `orden`.
- La flecha `↑` intercambia el grupo con el anterior.
- La flecha `↓` intercambia el grupo con el siguiente.
- La flecha superior se desactiva para el primer grupo.
- La flecha inferior se desactiva para el último grupo.
- Nunca se permite un valor de orden negativo.

## Modal de creación

Se abre al presionar `+ Nuevo grupo`.

Campos:

- `Nombre del grupo`, obligatorio.
- `Grupo activo`, activado por defecto.

El campo `orden` no se muestra. El sistema asigna automáticamente el siguiente orden disponible:

```text
MAX(orden) + 1
```

Si no existen grupos, el primer grupo recibe `orden = 1`.

Texto informativo:

> El orden se asignará automáticamente al final de la lista.

Acciones:

- `Cancelar`: cierra el modal sin guardar.
- `Guardar grupo`: crea el registro.

## Modal de edición

Se abre desde el botón `Editar` de una fila.

Campos:

- `Nombre del grupo`, obligatorio.
- `Grupo activo`.

El campo `orden` no se muestra y el orden actual se conserva. El reordenamiento se realiza exclusivamente con las flechas de la tabla.

Acciones:

- `Cancelar`: cierra el modal sin guardar.
- `Guardar grupo`: actualiza la fila seleccionada, sin crear una nueva.

## Paginación

- Opciones de registros por página: `25`, `50` y `100`.
- Botón `Anterior`.
- Botón `Siguiente`.
- Indicador `Página actual de total de páginas`.

## Estados visuales

- Cargando: muestra un indicador de carga dentro de la tabla.
- Sin resultados: muestra el mensaje `No hay grupos que coincidan con la búsqueda.`.
- Error: muestra un mensaje destacado sobre la tabla.
- Fila seleccionada: resalta la fila y actualiza la auditoría junto al buscador.

## Reglas funcionales

- El nombre es obligatorio y no puede repetirse.
- El orden se asigna automáticamente al crear.
- Editar nunca modifica el orden.
- Las flechas son la única forma manual de cambiar la posición.
- La fecha de creación y el creador se conservan en la base de datos, aunque no forman parte de las columnas de la tabla.

## API utilizada

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/grupos-menu` | Listar, buscar y paginar grupos. |
| `POST` | `/api/grupos-menu` | Crear un grupo con orden automático. |
| `PUT` | `/api/grupos-menu/:id` | Editar nombre y estado. |
| `POST` | `/api/grupos-menu/:id/orden` | Subir o bajar un grupo. |

Los endpoints están protegidos para usuarios con rol `admin` o `encargado`.
