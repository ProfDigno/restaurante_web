// Registro de acciones sensibles. auditar() escribe con el mismo cliente de la transacción
// de la acción: si la acción se deshace, el registro también; nunca queda una sin la otra.

export const ACCIONES = {
  PEDIDO_ANULADO: 'Pedido anulado',
  PEDIDO_LINEA_ANULADA: 'Línea de pedido quitada',
  PEDIDO_LINEA_REDUCIDA: 'Cantidad de pedido reducida',
  PEDIDO_DESCUENTO: 'Descuento de pedido',
  PEDIDO_PRECIO_MANUAL: 'Precio manual en pedido',
  PRODUCTO_MODIFICADO: 'Precio o stock de producto',
  INGREDIENTE_MODIFICADO: 'Precio o stock de ingrediente',
  COMPRA_ANULADA: 'Compra anulada',
  GASTO_ANULADO: 'Gasto anulado',
  VALE_ANULADO: 'Vale anulado',
  CAJA_CIERRE_DIFERENCIA: 'Cierre de caja con diferencia',
  FACTURA_CANCELADA: 'Factura cancelada',
  USUARIO_CREADO: 'Usuario creado',
  USUARIO_MODIFICADO: 'Usuario modificado',
  ROL_CREADO: 'Rol creado',
  ROL_MODIFICADO: 'Rol modificado',
  PERMISO_MODIFICADO: 'Permiso modificado'
};

export async function auditar(c, user, { accion, entidad, id = null, antes = null, despues = null, motivo = null }) {
  if (!ACCIONES[accion]) throw new Error(`Acción de auditoría desconocida: ${accion}`);
  await c.query(`INSERT INTO auditoria(fk_idusuario,usuario_login,ip,accion,entidad,id_entidad,antes,despues,motivo)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [
    Number.isSafeInteger(user?.sub) ? user.sub : null, user?.login || 'SISTEMA', user?.ip || null,
    accion, entidad, id, antes === null ? null : JSON.stringify(antes), despues === null ? null : JSON.stringify(despues), motivo || null
  ]);
}

// pg devuelve numeric como texto; para la auditoría se guardan como números.
export function numeros(row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value !== null && value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value]));
}

// Solo los campos que cambiaron, como { antes, despues }; null si no cambió ninguno.
// Compara como texto para que 1500 y '1500' (numeric de pg) cuenten como iguales.
export function cambios(antes, despues, campos) {
  const changed = campos.filter(campo => String(antes?.[campo] ?? '') !== String(despues?.[campo] ?? ''));
  if (!changed.length) return null;
  const pick = row => Object.fromEntries(changed.map(campo => [campo, row?.[campo] ?? null]));
  return { antes: pick(antes), despues: pick(despues) };
}
