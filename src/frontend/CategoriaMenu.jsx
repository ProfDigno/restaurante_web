import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';
import { formatInteger, formatMoney } from './formatters.js';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function Modal({ item, onClose, onSave, saving }) {
  const [form, setForm] = useState({ nombre: item?.nombre || '', descripcion: item?.descripcion || '', activa: item?.activa ?? true, imageFile: null, removeImage: false });
  const [preview, setPreview] = useState(item?.imagen_url || '');
  const [error, setError] = useState('');
  const chooseImage = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) return setError('Solo se permiten imágenes JPEG, PNG o WebP');
    if (file.size > MAX_IMAGE_SIZE) return setError('La imagen no puede superar los 5 MB');
    setError('');
    setForm({ ...form, imageFile: file, removeImage: false });
    setPreview(URL.createObjectURL(file));
  };
  const submit = async (event) => { event.preventDefault(); setError(''); try { await onSave(form); } catch (e) { setError(e.message); } };
  const removeImage = () => { setForm({ ...form, imageFile: null, removeImage: true }); setPreview(''); };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="categoria-modal-title"><div className="modal-head"><div><p className="eyebrow">{item ? 'EDITAR' : 'NUEVA CATEGORÍA'}</p><h2 id="categoria-modal-title">{item ? 'Editar categoría' : 'Crear categoría'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div><form onSubmit={submit} className="modal-form"><label>Nombre de la categoría<input autoFocus value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Entradas" maxLength={80} required /></label><label>Descripción<textarea value={form.descripcion} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} placeholder="Descripción opcional" maxLength={500} rows="3" /></label><div className="category-image-field"><span className="field-label">Imagen de la categoría</span><div className="category-image-picker">{preview ? <img src={preview} alt="Vista previa de la categoría" className="category-image-preview" /> : <div className="category-image-placeholder">Sin imagen</div>}<div className="category-image-actions"><label className="secondary file-button">{form.imageFile ? 'Cambiar imagen' : 'Seleccionar imagen'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseImage} /></label>{preview && <button type="button" className="outline" onClick={removeImage}>Quitar imagen</button>}<small>JPEG, PNG o WebP · máximo 5 MB</small></div></div></div>{!item && <p className="form-hint">El orden se asignará automáticamente al final de la lista.</p>}<label className="check-label"><input type="checkbox" checked={form.activa} onChange={(e) => setForm({ ...form, activa: e.target.checked })} /> Categoría activa</label>{error && <div className="alert error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar categoría'}</button></div></form></div></div>;
}

export default function CategoriaMenu() {
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [movingId, setMovingId] = useState(null);
  const [tab, setTab] = useState('categorias');
  const [productPage, setProductPage] = useState(1);
  const [productPageSize, setProductPageSize] = useState(25);
  const [products, setProducts] = useState({ items: [], total: 0, totalPages: 1, categoryId: null, page: 0, pageSize: 0 });
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ search, page, pageSize });
      const response = await fetch(`/api/categorias-menu?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las categorías');
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
      setSelected((current) => data.items.find((item) => item.idcategoria_menu === current?.idcategoria_menu) || current);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [search, page, pageSize]);
  useEffect(() => {
    if (tab !== 'productos' || !selected) return;
    let current = true;
    setProductsLoading(true);
    setProductsError('');
    const params = new URLSearchParams({ page: productPage, pageSize: productPageSize });
    fetch(`/api/categorias-menu/${selected.idcategoria_menu}/productos?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar los productos');
        if (current) setProducts({ ...data, categoryId: selected.idcategoria_menu });
      })
      .catch((e) => { if (current) setProductsError(e.message); })
      .finally(() => { if (current) setProductsLoading(false); });
    return () => { current = false; };
  }, [tab, selected?.idcategoria_menu, productPage, productPageSize]);

  const chooseCategory = (item) => {
    setSelected(item);
    setProductPage(1);
  };
  const save = async (form) => {
    setSaving(true);
    try {
      const editing = modal?.idcategoria_menu !== undefined;
      const hasUpload = form.imageFile || form.removeImage;
      let body;
      const headers = {};
      if (hasUpload) {
        body = new FormData();
        body.append('nombre', form.nombre);
        body.append('descripcion', form.descripcion);
        body.append('activa', String(form.activa));
        body.append('removeImage', String(form.removeImage));
        if (form.imageFile) body.append('image', form.imageFile);
      } else {
        body = JSON.stringify({ nombre: form.nombre, descripcion: form.descripcion, activa: form.activa });
        headers['Content-Type'] = 'application/json';
      }
      const response = await fetch(editing ? `/api/categorias-menu/${modal.idcategoria_menu}` : '/api/categorias-menu', { method: editing ? 'PUT' : 'POST', headers, body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la categoría');
      if (editing && selected?.idcategoria_menu === data.item.idcategoria_menu) setSelected(data.item);
      setModal(null);
      await load();
    } finally { setSaving(false); }
  };
  const toggle = async (item) => {
    setError('');
    try {
      const response = await fetch(`/api/categorias-menu/${item.idcategoria_menu}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: item.nombre, descripcion: item.descripcion, activa: !item.activa }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el estado');
      setItems((current) => current.map((row) => row.idcategoria_menu === item.idcategoria_menu ? data.item : row));
      if (selected?.idcategoria_menu === item.idcategoria_menu) setSelected(data.item);
    } catch (e) { setError(e.message); }
  };
  const move = async (item, direction) => {
    setMovingId(item.idcategoria_menu);
    setError('');
    try {
      const response = await fetch(`/api/categorias-menu/${item.idcategoria_menu}/orden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo reordenar la categoría');
      await load();
    } catch (e) { setError(e.message); }
    finally { setMovingId(null); }
  };
  const productReady = selected && products.categoryId === selected.idcategoria_menu && products.page === productPage && products.pageSize === productPageSize;

  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Buscar por nombre…" /></div>{tab === 'categorias' && <button className="primary" onClick={() => setModal({})}>+ Nueva categoría</button>}</TopbarSlot>
    <div className="catalog-page-tabs" role="tablist" aria-label="Vistas de categorías">
      <button type="button" role="tab" id="categories-tab" aria-controls="categories-panel" aria-selected={tab === 'categorias'} className={tab === 'categorias' ? 'active' : ''} onClick={() => setTab('categorias')}>Categorías</button>
      <button type="button" role="tab" id="category-products-tab" aria-controls="category-products-panel" aria-selected={tab === 'productos'} className={tab === 'productos' ? 'active' : ''} onClick={() => setTab('productos')}>Productos de la categoría</button>
    </div>
    {tab === 'categorias' ? <section role="tabpanel" id="categories-panel" aria-labelledby="categories-tab">
      <TopbarSlot name="sub"><div className="toolbar-audit">{selected ? <><strong>{selected.nombre}</strong><span>{selected.fecha_creado ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selected.fecha_creado)) : '—'} · {selected.creado_por}</span></> : <span>Seleccioná una categoría para ver fecha y creador</span>}</div><div className="result-count">{total} {total === 1 ? 'categoría' : 'categorías'}</div></TopbarSlot>
      {error && <div className="alert error catalog-error">{error}</div>}
      <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Imagen</th><th>Nombre</th><th>Descripción</th><th>Orden</th><th>Estado</th><th className="actions-col">Acciones</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="table-loading"><div className="loader" />Cargando categorías…</td></tr> : items.length === 0 ? <tr><td colSpan="6" className="table-empty">No hay categorías que coincidan con la búsqueda.</td></tr> : items.map((item, index) => <tr key={item.idcategoria_menu} onClick={() => chooseCategory(item)} className={`${!item.activa ? 'inactive-row ' : ''}${selected?.idcategoria_menu === item.idcategoria_menu ? 'selected-row' : ''}`}><td><div className="category-thumbnail">{item.imagen_url ? <img src={item.imagen_url} alt={`Miniatura de ${item.nombre}`} /> : <span>—</span>}</div></td><td><strong>{item.nombre}</strong><small>{`ID ${item.idcategoria_menu}`}</small></td><td className="description-cell">{item.descripcion || '—'}</td><td><div className="order-cell"><span>{item.orden}</span><span className="order-buttons"><button className="order-button" title="Subir" aria-label={`Subir ${item.nombre}`} disabled={index === 0 || movingId === item.idcategoria_menu || loading} onClick={(event) => { event.stopPropagation(); move(item, 'up'); }}>↑</button><button className="order-button" title="Bajar" aria-label={`Bajar ${item.nombre}`} disabled={index === items.length - 1 || movingId === item.idcategoria_menu || loading} onClick={(event) => { event.stopPropagation(); move(item, 'down'); }}>↓</button></span></div></td><td><label className="switch"><input type="checkbox" checked={item.activa} onChange={() => toggle(item)} /><span className="slider" /></label><span className={`state-label ${item.activa ? 'on' : 'off'}`}>{item.activa ? 'Activa' : 'Inactiva'}</span></td><td className="actions-col"><button className="edit-button" onClick={(event) => { event.stopPropagation(); chooseCategory(item); setModal(item); }}>Editar</button></td></tr>)}</tbody></table></div>
      <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><span>Página {page} de {totalPages}</span><div className="pagination"><button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>
    </section> : <section role="tabpanel" id="category-products-panel" aria-labelledby="category-products-tab">
      {!selected ? <div className="empty-state">Seleccioná una categoría en la primera pestaña para ver sus productos.</div> : <>
        <TopbarSlot name="sub"><div><strong>{selected.nombre}</strong><p className="muted">Productos de esta categoría, incluidos los inactivos.</p></div><span className="result-count">{productReady ? products.total : '…'} {productReady && products.total === 1 ? 'producto' : 'productos'}</span></TopbarSlot>
        {productsError && <div className="alert error catalog-error">{productsError}</div>}
        <div className="catalog-table-wrap"><table className="catalog-table category-products-table"><thead><tr><th>Nombre</th><th>Grupo</th><th>Unidad</th><th>Precio venta</th><th>Stock actual</th><th>Estado</th></tr></thead><tbody>{productsError ? <tr><td colSpan="6" className="table-empty">No se pudieron cargar los productos.</td></tr> : productsLoading || !productReady ? <tr><td colSpan="6" className="table-loading"><div className="loader" />Cargando productos…</td></tr> : products.items.length === 0 ? <tr><td colSpan="6" className="table-empty">Esta categoría no tiene productos.</td></tr> : products.items.map((item) => <tr key={item.idproducto_menu} className={!item.activo ? 'inactive-row' : ''}><td><strong>{item.nombre}</strong><small>ID {item.idproducto_menu}</small></td><td>{item.grupo_nombre}</td><td>{item.unidad_nombre}</td><td>{formatMoney(item.precio_venta)}</td><td>{formatInteger(item.stock_actual)}</td><td><span className={`state-label ${item.activo ? 'on' : 'off'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td></tr>)}</tbody></table></div>
        <div className="catalog-footer"><label>Mostrar <select value={productPageSize} onChange={(e) => { setProductPageSize(Number(e.target.value)); setProductPage(1); }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><span>Página {productPage} de {productReady ? products.totalPages : '…'}</span><div className="pagination"><button className="page-button" disabled={productPage <= 1 || productsLoading} onClick={() => setProductPage(productPage - 1)}>Anterior</button><button className="page-button" disabled={!productReady || productPage >= products.totalPages || productsLoading} onClick={() => setProductPage(productPage + 1)}>Siguiente</button></div></div>
      </>}
    </section>}
    {modal && <Modal item={modal.idcategoria_menu !== undefined ? modal : null} onClose={() => setModal(null)} onSave={save} saving={saving} />}
  </div>;
}
