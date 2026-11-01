import { useEffect, useState } from 'react';

function Modal({ item, onClose, onSave, saving }) {
  const [form, setForm] = useState({ nombre: item?.nombre || '', activo: item?.activo ?? true });
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try { await onSave(form); } catch (saveError) { setError(saveError.message); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ubicacion-mesa-modal-title">
      <div className="modal-head"><div><p className="eyebrow">{item ? 'EDITAR' : 'NUEVA UBICACIÓN'}</p><h2 id="ubicacion-mesa-modal-title">{item ? 'Editar ubicación de mesas' : 'Crear ubicación de mesas'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div>
      <form onSubmit={submit} className="modal-form">
        <label>Nombre de la ubicación<input autoFocus value={form.nombre} onChange={(event) => setForm({ ...form, nombre: event.target.value })} placeholder="Ej. Salón o Terraza" maxLength={80} required /></label>
        {!item && <p className="form-hint">El orden se asignará automáticamente al final de la lista.</p>}
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={(event) => setForm({ ...form, activo: event.target.checked })} /> Ubicación activa</label>
        <p className="form-hint">Al cambiar el estado, todas las mesas de esta ubicación tendrán el mismo estado.</p>
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar ubicación'}</button></div>
      </form>
    </div>
  </div>;
}

export default function UbicacionMesa() {
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
  const [selectedId, setSelectedId] = useState(null);
  const [movingId, setMovingId] = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ search, page, pageSize });
      const response = await fetch(`/api/ubicaciones-mesa?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las ubicaciones');
      setItems(data.items); setTotal(data.total); setTotalPages(data.totalPages);
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [search, page, pageSize]);

  const save = async (form) => {
    setSaving(true);
    try {
      const editing = modal?.idubicacion_mesa !== undefined;
      const response = await fetch(editing ? `/api/ubicaciones-mesa/${modal.idubicacion_mesa}` : '/api/ubicaciones-mesa', {
        method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la ubicación');
      setModal(null); await load();
    } finally { setSaving(false); }
  };
  const toggle = async (item) => {
    setError('');
    try {
      const response = await fetch(`/api/ubicaciones-mesa/${item.idubicacion_mesa}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: item.nombre, activo: !item.activo }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar el estado');
      setItems((current) => current.map((entry) => entry.idubicacion_mesa === item.idubicacion_mesa ? data.item : entry));
    } catch (toggleError) { setError(toggleError.message); }
  };
  const move = async (item, direction) => {
    setMovingId(item.idubicacion_mesa); setError('');
    try {
      const response = await fetch(`/api/ubicaciones-mesa/${item.idubicacion_mesa}/orden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo reordenar la ubicación');
      await load();
    } catch (moveError) { setError(moveError.message); } finally { setMovingId(null); }
  };

  const selected = items.find((item) => item.idubicacion_mesa === selectedId);
  return <div className="catalog-page">
    <div className="page-intro"><div><p className="eyebrow">CATÁLOGO</p><h2>Ubicaciones de mesas</h2><p className="muted">Organizá las mesas por sectores como Salón, Terraza o Patio.</p></div><button className="primary" onClick={() => setModal({})}>+ Nueva ubicación</button></div>
    <div className="catalog-toolbar"><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nombre…" /></div><div className="toolbar-audit">{selected ? <><strong>{selected.nombre}</strong><span>{selected.fecha_creado ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selected.fecha_creado)) : '—'} · {selected.creado_por}</span></> : <span>Seleccioná una ubicación para ver fecha y creador</span>}</div><div className="result-count">{total} {total === 1 ? 'ubicación' : 'ubicaciones'}</div></div>
    {error && <div className="alert error catalog-error">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Nombre</th><th>Mesas</th><th>Orden</th><th>Estado</th><th className="actions-col">Acciones</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="5" className="table-loading"><div className="loader" />Cargando ubicaciones…</td></tr> : items.length === 0 ? <tr><td colSpan="5" className="table-empty">No hay ubicaciones que coincidan con la búsqueda.</td></tr> : items.map((item, index) => <tr key={item.idubicacion_mesa} onClick={() => setSelectedId(item.idubicacion_mesa)} className={`${!item.activo ? 'inactive-row ' : ''}${selectedId === item.idubicacion_mesa ? 'selected-row' : ''}`}><td><strong>{item.nombre}</strong><small>ID {item.idubicacion_mesa}</small></td><td>{item.cantidad_mesas}</td><td><div className="order-cell"><span>{item.orden}</span><span className="order-buttons"><button className="order-button" title="Subir" disabled={index === 0 || movingId === item.idubicacion_mesa || loading} onClick={(event) => { event.stopPropagation(); move(item, 'up'); }}>↑</button><button className="order-button" title="Bajar" disabled={index === items.length - 1 || movingId === item.idubicacion_mesa || loading} onClick={(event) => { event.stopPropagation(); move(item, 'down'); }}>↓</button></span></div></td><td><label className="switch" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={item.activo} onChange={() => toggle(item)} /><span className="slider" /></label><span className={`state-label ${item.activo ? 'on' : 'off'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td><td className="actions-col"><button className="edit-button" onClick={(event) => { event.stopPropagation(); setSelectedId(item.idubicacion_mesa); setModal(item); }}>Editar</button></td></tr>)}
    </tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option value="25">25</option><option value="50">50</option><option value="100">100</option></select></label><span>Página {page} de {totalPages}</span><div className="pagination"><button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>
    {modal && <Modal item={modal.idubicacion_mesa !== undefined ? modal : null} onClose={() => setModal(null)} onSave={save} saving={saving} />}
  </div>;
}
