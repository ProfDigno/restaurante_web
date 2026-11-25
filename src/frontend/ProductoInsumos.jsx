import { useEffect, useState } from 'react';
import { api } from './pedidos-api.js';

// Hasta 11 enteros y 3 decimales, como numeric(14,3).
export const validSupplyQuantity = (value) => /^\d{1,11}(\.\d{1,3})?$/.test(String(value).trim()) && Number(value) > 0;

// Pestaña Insumos del producto: la lista vive en el modal para guardarse junto con el producto.
export default function ProductoInsumos({ items, setItems }) {
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState([]);
  const [searching, setSearching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setSearching(true);
    setError('');
    const timer = setTimeout(() => {
      api(`/api/insumos?${new URLSearchParams({ search, pageSize: 100, soloActivos: 'true' })}`, { signal: controller.signal })
        .then((data) => setOptions(data.items))
        .catch((reason) => { if (!controller.signal.aborted) setError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search]);

  const selectedIds = new Set(items.map((item) => item.idinsumo));
  const add = (supply) => {
    setItems((current) => current.some((item) => item.idinsumo === supply.idinsumo) ? current : [...current, { ...supply, cantidad: '1' }]);
    setSearch('');
  };
  const update = (id, cantidad) => setItems((current) => current.map((item) => item.idinsumo === id ? { ...item, cantidad } : item));
  const remove = (id) => setItems((current) => current.filter((item) => item.idinsumo !== id));

  return <>
    <label>Buscar insumo<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nombre o unidad…" /></label>
    <div className="ingredient-search-results" aria-label="Insumos disponibles">{searching ? <p>Buscando…</p>
      : error ? <p role="alert">{error}</p>
      : options.length ? options.map((supply) => <button type="button" key={supply.idinsumo} disabled={selectedIds.has(supply.idinsumo)} onClick={() => add(supply)}>{supply.nombre} <small>· {supply.unidad_codigo}</small></button>)
      : <p>No hay insumos disponibles.</p>}</div>
    <div className="product-ingredient-list"><h3>Insumos del producto</h3>{items.length ? items.map((item) => <div className="product-ingredient-row product-supply-row" key={item.idinsumo}>
      <div className="ingredient-name"><strong>{item.nombre}</strong>{!item.activo && <small>Inactivo</small>}</div>
      <label className="ingredient-quantity">Cantidad<input type="number" min="0.001" step="any" value={item.cantidad} onChange={(event) => update(item.idinsumo, event.target.value)} /></label>
      <span className="ingredient-unit">{item.unidad_codigo}</span>
      <button type="button" className="edit-button ingredient-remove" onClick={() => remove(item.idinsumo)} aria-label={`Quitar ${item.nombre}`}>Quitar</button>
    </div>) : <p className="muted">Todavía no hay insumos agregados.</p>}</div>
  </>;
}
