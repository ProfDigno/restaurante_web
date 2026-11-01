import { useEffect, useState } from 'react';
import MoneyInput from './MoneyInput.jsx';
import { normalizeMoneyValue } from './money-input.js';
import { formatMoney } from './formatters.js';

const numericFields = ['precio_venta', 'precio_compra', 'stock_actual', 'stock_minimo'];
const numericLabels = { precio_venta: 'precio de venta', precio_compra: 'precio de compra', stock_actual: 'stock actual', stock_minimo: 'stock mínimo' };
const parsedInteger = (value) => {
  const digits = normalizeMoneyValue(value);
  return digits && Number.isSafeInteger(Number(digits)) ? Number(digits) : null;
};
const validQuantity = (value) => /^[1-9]\d{0,13}$/.test(String(value).trim()) && Number.isSafeInteger(Number(value));

export default function ProductoMenuModal({ item, options, onClose, onSave, saving }) {
  const editing = item?.idproducto_menu !== undefined && item?.idproducto_menu !== null;
  const [tab, setTab] = useState('data');
  const [form, setForm] = useState({
    nombre: item?.nombre || '', descripcion: item?.descripcion || '',
    fk_idcategoria_menu: item?.fk_idcategoria_menu ?? '',
    fk_idgrupo_menu: item?.fk_idgrupo_menu ?? '',
    fk_idunidad_menu: item?.fk_idunidad_menu ?? '',
    precio_venta: item?.precio_venta ?? 0, precio_compra: item?.precio_compra ?? 0,
    stock_actual: item?.stock_actual ?? 0, stock_minimo: item?.stock_minimo ?? 0,
    activo: item?.activo ?? true, es_descontar_stock: item?.es_descontar_stock ?? false,
    es_cocina: item?.es_cocina ?? true, es_vender: item?.es_vender ?? true,
    es_comprar: item?.es_comprar ?? false
  });
  const [ingredients, setIngredients] = useState([]);
  const [ingredientLoading, setIngredientLoading] = useState(editing);
  const [ingredientLoadError, setIngredientLoadError] = useState('');
  const [ingredientSearch, setIngredientSearch] = useState('');
  const [ingredientOptions, setIngredientOptions] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!editing) return;
    const controller = new AbortController();
    fetch(`/api/productos-menu/${item.idproducto_menu}/ingredientes`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los ingredientes');
        setIngredients(data.items.map((ingredient) => ({ ...ingredient, cantidad: String(ingredient.cantidad) })));
      })
      .catch((reason) => { if (reason.name !== 'AbortError') setIngredientLoadError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setIngredientLoading(false); });
    return () => controller.abort();
  }, [editing, item?.idproducto_menu]);

  useEffect(() => {
    if (tab !== 'ingredients') return;
    const controller = new AbortController();
    setSearchLoading(true);
    setIngredientOptions([]);
    const timer = setTimeout(() => {
      fetch(`/api/ingredientes?${new URLSearchParams({ search: ingredientSearch, pageSize: 100 })}`, { signal: controller.signal })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'No se pudo buscar ingredientes');
          setIngredientOptions(data.items.filter((ingredient) => ingredient.activo));
        })
        .catch((reason) => { if (reason.name !== 'AbortError') setError(reason.message); })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [tab, ingredientSearch]);

  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateIngredient = (id, quantity) => setIngredients((current) => current.map((ingredient) => ingredient.idingrediente === id ? { ...ingredient, cantidad: quantity } : ingredient));
  const addIngredient = (ingredient) => {
    if (ingredients.some((current) => current.idingrediente === ingredient.idingrediente)) {
      setError('Ese ingrediente ya está agregado');
      return;
    }
    setIngredients((current) => [...current, { ...ingredient, cantidad: '1' }]);
    setIngredientSearch('');
    setError('');
  };
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    const invalidSelect = (key) => form[key] === '' || form[key] === null || form[key] === undefined || !Number.isInteger(Number(form[key])) || Number(form[key]) < 0;
    if (!form.nombre.trim()) {
      setTab('data');
      setError('Ingresá el nombre del producto');
      return;
    }
    if (['fk_idcategoria_menu', 'fk_idgrupo_menu', 'fk_idunidad_menu'].some(invalidSelect)) {
      setTab('data');
      setError('Seleccioná categoría, grupo y unidad de menú');
      return;
    }
    const invalidNumericField = numericFields.find((key) => parsedInteger(form[key]) === null);
    if (invalidNumericField) {
      setTab('data');
      setError(`Ingresá un valor entero válido para ${numericLabels[invalidNumericField]}`);
      return;
    }
    if (editing && ingredients.some((ingredient) => !validQuantity(ingredient.cantidad))) {
      setTab('ingredients');
      setError('Cada cantidad debe ser un número entero mayor a cero');
      return;
    }
    try {
      await onSave({ ...form,
        fk_idcategoria_menu: Number(form.fk_idcategoria_menu),
        fk_idgrupo_menu: Number(form.fk_idgrupo_menu),
        fk_idunidad_menu: Number(form.fk_idunidad_menu),
        ...Object.fromEntries(numericFields.map((key) => [key, parsedInteger(form[key])])),
        ...(editing ? { ingredientes: ingredients.map((ingredient) => ({ idingrediente: ingredient.idingrediente, cantidad: String(ingredient.cantidad).trim() })) } : {})
      });
    } catch (reason) { setError(reason.message); }
  };
  const select = (key, label, values) => <label key={key}>{label}<select value={form[key]} onChange={(event) => update(key, event.target.value)} required><option value="">Seleccioná…</option>{values.map((value) => <option key={value[`id${key.replace('fk_id', '')}`]} value={value[`id${key.replace('fk_id', '')}`]}>{value.nombre}</option>)}</select></label>;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="producto-modal-title">
      <div className="modal-head"><div><p className="eyebrow">{editing ? 'EDITAR' : 'NUEVO PRODUCTO'}</p><h2 id="producto-modal-title">{editing ? 'Editar producto del menú' : 'Crear producto del menú'}</h2></div><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div>
      <div className="product-modal-tabs" role="tablist" aria-label="Secciones del producto">
        <button type="button" role="tab" id="product-data-tab" aria-controls="product-data-panel" aria-selected={tab === 'data'} className={tab === 'data' ? 'active' : ''} onClick={() => setTab('data')}>Datos</button>
        <button type="button" role="tab" id="product-ingredients-tab" aria-controls="product-ingredients-panel" aria-selected={tab === 'ingredients'} className={tab === 'ingredients' ? 'active' : ''} disabled={!editing} title={!editing ? 'Guardá el producto antes de agregar ingredientes' : undefined} onClick={() => setTab('ingredients')}>Ingredientes{editing ? ` (${ingredients.length})` : ''}</button>
      </div>
      <form className="modal-form" onSubmit={submit} noValidate>
        {tab === 'data' && <div id="product-data-panel" role="tabpanel" aria-labelledby="product-data-tab" className="product-tab-panel">
          <label>Nombre del producto<input autoFocus value={form.nombre} onChange={(event) => update('nombre', event.target.value)} placeholder="Ej. Hamburguesa clásica" maxLength={120} required /></label>
          <label>Descripción<textarea value={form.descripcion} onChange={(event) => update('descripcion', event.target.value)} placeholder="Descripción opcional" rows="2" /></label>
          <div className="form-grid">{select('fk_idcategoria_menu', 'Categoría', options.categorias)}{select('fk_idgrupo_menu', 'Grupo de menú', options.grupos)}{select('fk_idunidad_menu', 'Unidad de menú', options.unidades)}{numericFields.map((key) => <label key={key}>{key === 'precio_venta' ? 'Precio de venta' : key === 'precio_compra' ? 'Precio de compra' : key === 'stock_actual' ? 'Stock actual' : 'Stock mínimo'}<MoneyInput min={0} value={form[key]} onValueChange={(value) => update(key, value)} required /></label>)}</div>
          <div className="flag-grid"><label className="check-label"><input type="checkbox" checked={form.activo} onChange={(event) => update('activo', event.target.checked)} /> Activo</label><label className="check-label"><input type="checkbox" checked={form.es_vender} onChange={(event) => update('es_vender', event.target.checked)} /> Se puede vender</label><label className="check-label"><input type="checkbox" checked={form.es_descontar_stock} onChange={(event) => update('es_descontar_stock', event.target.checked)} /> Descontar stock</label><label className="check-label"><input type="checkbox" checked={form.es_cocina} onChange={(event) => update('es_cocina', event.target.checked)} /> Es de cocina</label><label className="check-label"><input type="checkbox" checked={form.es_comprar} onChange={(event) => update('es_comprar', event.target.checked)} /> Se puede comprar</label></div>
        </div>}
        {tab === 'ingredients' && <div id="product-ingredients-panel" role="tabpanel" aria-labelledby="product-ingredients-tab" className="product-tab-panel">
          <p className="product-ingredients-help">Ingredientes de referencia para este producto. No se descuentan del stock al vender.</p>
          {ingredientLoading ? <p>Cargando ingredientes…</p> : ingredientLoadError ? <div className="alert error">{ingredientLoadError}</div> : <>
            <label>Buscar ingrediente<input type="search" value={ingredientSearch} onChange={(event) => setIngredientSearch(event.target.value)} placeholder="Buscar por nombre o unidad…" /></label>
            <div className="ingredient-search-results" aria-label="Ingredientes disponibles">{searchLoading ? <p>Buscando…</p> : ingredientOptions.length ? ingredientOptions.map((ingredient) => <button type="button" key={ingredient.idingrediente} disabled={ingredients.some((selected) => selected.idingrediente === ingredient.idingrediente)} onClick={() => addIngredient(ingredient)}>{ingredient.nombre} <small>· {ingredient.unidad_codigo}</small></button>) : <p>No hay ingredientes disponibles.</p>}</div>
            <div className="product-ingredient-list"><h3>Ingredientes del producto</h3>{ingredients.length ? ingredients.map((ingredient) => <div className="product-ingredient-row" key={ingredient.idingrediente}><div className="ingredient-name"><strong>{ingredient.nombre}</strong>{!ingredient.activo && <small>Inactivo</small>}</div><label className="ingredient-quantity">Cantidad<input type="number" min="1" step="1" value={ingredient.cantidad} onChange={(event) => updateIngredient(ingredient.idingrediente, event.target.value)} /></label><span className="ingredient-unit">{ingredient.unidad_codigo}</span><div className="ingredient-price"><span>Precio de venta</span><strong>{formatMoney(ingredient.precio_venta)}</strong></div><button type="button" className="edit-button ingredient-remove" onClick={() => setIngredients((current) => current.filter((selected) => selected.idingrediente !== ingredient.idingrediente))} aria-label={`Quitar ${ingredient.nombre}`}>Quitar</button></div>) : <p className="muted">Todavía no hay ingredientes agregados.</p>}</div>
          </>}
        </div>}
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={saving || ingredientLoading || Boolean(ingredientLoadError)}>{saving ? 'Guardando…' : 'Guardar producto'}</button></div>
      </form>
    </div>
  </div>;
}
