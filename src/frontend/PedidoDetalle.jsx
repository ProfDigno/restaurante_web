import { Fragment, useEffect, useState } from 'react';
import { api } from './pedidos-api.js';
import { formatInteger, formatMoney } from './formatters.js';

export default function PedidoDetalle({ detalles, editable, busy, onChange }) {
  const [selected, setSelected] = useState(null);
  const [selectedIngredient, setSelectedIngredient] = useState(null);
  const [mode, setMode] = useState(null);
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const productId = selected === null ? null : detalles[selected]?.fk_idproducto_menu;

  useEffect(() => {
    if (selected !== null && selected >= detalles.length) {
      setSelected(null);
      setSelectedIngredient(null);
      setMode(null);
    }
  }, [selected, detalles.length]);

  useEffect(() => {
    if (productId === null || productId === undefined) return;
    let current = true;
    setLoading(true);
    setError('');
    api(`/api/pedidos/productos/${productId}/ingredientes`)
      .then(data => { if (current) setOptions(data.items); })
      .catch(reason => { if (current) setError(reason.message); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [productId]);

  const select = index => {
    setSelectedIngredient(null);
    if (selected !== index) {
      if (detalles[selected]?.fk_idproducto_menu !== detalles[index]?.fk_idproducto_menu) {
        setOptions([]);
        setError('');
      }
      setSelected(index);
      setMode(null);
    }
  };
  const removeProduct = index => {
    onChange(detalles.filter((_, position) => position !== index));
    setSelected(current => current === index ? null : current > index ? current - 1 : current);
    setSelectedIngredient(null);
    setMode(null);
  };
  const changeQuantity = (index, delta) => onChange(detalles.map((detail, position) => position === index
    ? { ...detail, cantidad: Math.max(1, Number(detail.cantidad) + delta) } : detail));
  const addIngredient = ingredient => {
    if (selected === null || !mode) return;
    const detail = detalles[selected];
    if ((detail.ingredientes || []).some(item => item.idingrediente === ingredient.idingrediente)) return;
    const addition = { idingrediente: ingredient.idingrediente, tipo_modificacion: mode,
      cantidad: ingredient.cantidad, precio_venta: mode === 'AGREGAR' ? ingredient.precio_venta : 0,
      nombre: ingredient.nombre, unidad_codigo: ingredient.unidad_codigo };
    onChange(detalles.map((item, index) => index === selected
      ? { ...item, ingredientes: [...(item.ingredientes || []), addition] } : item));
    setMode(null);
  };
  const removeIngredient = (detailIndex, ingredientId) => {
    onChange(detalles.map((detail, index) => index === detailIndex
      ? { ...detail, ingredientes: (detail.ingredientes || []).filter(item => item.idingrediente !== ingredientId) } : detail));
    setSelectedIngredient(null);
  };
  const selectedDetail = selected === null ? null : detalles[selected];
  const available = options.filter(item => !(selectedDetail?.ingredientes || []).some(chosen => chosen.idingrediente === item.idingrediente));
  const showModifierActions = selectedDetail && selectedIngredient === null && !loading && !error && options.length > 0;

  return <section className="order-panel order-detail">
    <h3>Detalle del pedido</h3>
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Producto</th><th className="numeric-cell">Cant.</th><th className="numeric-cell">Precio venta</th><th className="numeric-cell">Subtotal</th><th /></tr></thead><tbody>
      {!detalles.length ? <tr><td colSpan="5">Seleccioná un producto para comenzar.</td></tr> : detalles.map((detail, index) => <Fragment key={detail.iddetalle_pedido || `new-${index}`}>
        <tr className={selected === index && selectedIngredient === null ? 'selected-detail-row' : ''} onClick={() => select(index)}>
          <td><button type="button" className="detail-select" aria-pressed={selected === index && selectedIngredient === null} onClick={event => { event.stopPropagation(); select(index); }}><strong>{detail.nombre_mostrado || detail.nombre}</strong></button><small>Unidad: {detail.unidad || '—'}</small></td>
          <td className="numeric-cell"><div className="quantity-controls"><button type="button" aria-label={`Disminuir ${detail.nombre}`} disabled={!editable || busy || Number(detail.cantidad) <= 1} onClick={event => { event.stopPropagation(); changeQuantity(index, -1); }}>−</button><span>{detail.cantidad}</span><button type="button" aria-label={`Aumentar ${detail.nombre}`} disabled={!editable || busy} onClick={event => { event.stopPropagation(); changeQuantity(index, 1); }}>+</button></div></td>
          <td className="numeric-cell">{formatMoney(detail.precio_venta)}</td><td className="numeric-cell">{formatMoney(Number(detail.cantidad) * Number(detail.precio_venta))}</td>
          <td><button type="button" className="remove-line" aria-label={`Eliminar ${detail.nombre}`} disabled={!editable || busy} onClick={event => { event.stopPropagation(); removeProduct(index); }}>×</button></td>
        </tr>
        {(detail.ingredientes || []).map(ingredient => <tr key={`${ingredient.tipo_modificacion}-${ingredient.idingrediente}`} className={`${ingredient.tipo_modificacion === 'AGREGAR' ? 'ingredient-added-row' : 'ingredient-removed-row'}${selectedIngredient === `${index}:${ingredient.idingrediente}` ? ' selected-ingredient-row' : ''}`} onClick={() => { select(index); setSelectedIngredient(`${index}:${ingredient.idingrediente}`); setMode(null); }}>
          <td><strong>{ingredient.tipo_modificacion === 'AGREGAR' ? '+ ' : '− '}{ingredient.nombre}</strong><small>{formatInteger(ingredient.cantidad)} {ingredient.unidad_codigo} por producto</small></td>
          <td className="numeric-cell">{formatInteger(detail.cantidad)}</td>
          <td className="numeric-cell">{formatMoney(ingredient.tipo_modificacion === 'AGREGAR' ? ingredient.precio_venta : 0)}</td>
          <td className="numeric-cell">{formatMoney(ingredient.tipo_modificacion === 'AGREGAR' ? Number(detail.cantidad) * Number(ingredient.precio_venta) : 0)}</td>
          <td><button type="button" className="remove-line" aria-label={`Eliminar modificación ${ingredient.nombre}`} disabled={!editable || busy} onClick={event => { event.stopPropagation(); removeIngredient(index, ingredient.idingrediente); }}>×</button></td>
        </tr>)}
      </Fragment>)}
    </tbody></table></div>
    {showModifierActions && <div className="ingredient-modifier-toolbar"><span>{selectedDetail.nombre_mostrado || selectedDetail.nombre}</span><div><button type="button" className="modifier-add-button" disabled={!editable || busy} onClick={() => setMode(current => current === 'AGREGAR' ? null : 'AGREGAR')}>AGREGAR</button><button type="button" className="modifier-remove-button" disabled={!editable || busy} onClick={() => setMode(current => current === 'QUITAR' ? null : 'QUITAR')}>QUITAR</button></div></div>}
    {mode && selectedDetail && <div className="ingredient-modifier-picker" aria-label={`${mode === 'AGREGAR' ? 'Agregar' : 'Quitar'} ingrediente de ${selectedDetail.nombre}`}>
      {loading ? <span>Cargando ingredientes…</span> : error ? <span className="danger">{error}</span> : available.length ? available.map(ingredient => <button type="button" key={ingredient.idingrediente} onClick={() => addIngredient(ingredient)}><strong>{ingredient.nombre}</strong><small>{formatInteger(ingredient.cantidad)} {ingredient.unidad_codigo} · {mode === 'AGREGAR' ? formatMoney(ingredient.precio_venta) : 'Sin cargo'}</small></button>) : <span>No hay más ingredientes disponibles para este producto.</span>}
    </div>}
  </section>;
}
