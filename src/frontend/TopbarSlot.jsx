import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Coloca contenido de una pantalla en el encabezado superior de la app:
// name="slot" (por defecto) → botones y filtros a la derecha; name="sub" → texto de apoyo bajo el título.
// Fuera de la app principal (ventanas "Solo …") no existe el encabezado y se muestra en línea.
export default function TopbarSlot({ name = 'slot', children }) {
  const id = name === 'sub' ? 'topbar-sub' : 'topbar-slot';
  const [target, setTarget] = useState(undefined);
  useLayoutEffect(() => { setTarget(document.getElementById(id)); }, [id]);
  if (target === undefined) return null;
  if (target) return createPortal(children, target);
  return name === 'sub' ? <div className="catalog-toolbar">{children}</div> : <div className="page-intro">{children}</div>;
}
