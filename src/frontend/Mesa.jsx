import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';

function Modal({ item, locations, onClose, onSave, saving }) {
  const [form, setForm] = useState({
    numero: item?.numero || '',
    capacidad: item?.capacidad || 2,
    fk_idubicacion_mesa: item?.fk_idubicacion_mesa || '',
    activa: item?.activa ?? true
  });
  const [error, setError] = useState('');
  const selectedLocation = locations.find((location) => location.idubicacion_mesa === Number(form.fk_idubicacion_mesa));
  const submit = async (event) => {
    event.preventDefault(); setError('');
    try {
      await onSave({ ...form, numero: Number(form.numero), capacidad: Number(form.capacidad), fk_idubicacion_mesa: Number(form.fk_idubicacion_mesa) });
    } catch (saveError) { setError(saveError.message); }
  };
  const changeLocation = (event) => {
    const id = Number(event.target.value);
    const location = locations.find((entry) => entry.idubicacion_mesa === id);
    setForm({ ...form, fk_idubicacion_mesa: event.target.value, activa: location?.activo ? form.activa : false });
  };
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal-head"><div><p className="eyebrow">{item ? 'EDITAR' : 'NUEVA MESA'}</p><h2>{item ? 'Editar mesa' : 'Crear mesa'}</h2></div><button className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div>
      <form className="modal-form" onSubmit={submit}>
        <div className="form-grid"><label>Número<input autoFocus type="number" min="1" step="1" value={form.numero} onChange={(event) => setForm({ ...form, numero: event.target.value })} required /></label><label>Capacidad<input type="number" min="1" step="1" value={form.capacidad} onChange={(event) => setForm({ ...form, capacidad: event.target.value })} required /></label></div>
        <label>Ubicación<select value={form.fk_idubicacion_mesa} onChange={changeLocation} required><option value="">Seleccionar ubicación</option>{locations.map((location) => <option key={location.idubicacion_mesa} value={location.idubicacion_mesa} disabled={!location.activo && location.idubicacion_mesa !== item?.fk_idubicacion_mesa}>{location.nombre}{location.activo ? '' : ' (Inactiva)'}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={form.activa} disabled={selectedLocation && !selectedLocation.activo} onChange={(event) => setForm({ ...form, activa: event.target.checked })} /> Mesa activa</label>
        {selectedLocation && !selectedLocation.activo && <p className="form-hint">La mesa no puede activarse mientras su ubicación esté inactiva.</p>}
        {error && <div className="alert error">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar mesa'}</button></div>
      </form>
    </div>
  </div>;
}

export default function Mesa() {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
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

  const load = async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/mesas-config?search=${encodeURIComponent(search)}&page=${page}&pageSize=${pageSize}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las mesas');
      setItems(data.items); setTotal(data.total); setTotalPages(data.totalPages);
    } catch (loadError) { setError(loadError.message); } finally { setLoading(false); }
  };
  const loadLocations = async () => {
    const response = await fetch('/api/ubicaciones-mesa/opciones?incluirInactivas=true');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las ubicaciones');
    setLocations(data.items);
  };
  useEffect(() => { load(); }, [search, page, pageSize]);
  useEffect(() => { loadLocations().catch((loadError) => setError(loadError.message)); }, []);

  const save = async (form) => {
    setSaving(true);
    try {
      const id = modal?.idmesa;
      const response = await fetch(id ? `/api/mesas-config/${id}` : '/api/mesas-config', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo guardar la mesa');
      setModal(null); await load();
    } finally { setSaving(false); }
  };
  const toggle = async (item) => {
    setError('');
    try {
      const response = await fetch(`/api/mesas-config/${item.idmesa}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, activa: !item.activa }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo actualizar la mesa');
      setItems((current) => current.map((entry) => entry.idmesa === item.idmesa ? data.item : entry));
    } catch (toggleError) { setError(toggleError.message); }
  };
  const selected = items.find((item) => item.idmesa === selectedId);

  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por número o ubicación…" /></div><button className="primary" onClick={() => setModal({})} disabled={!locations.some((location) => location.activo)}>+ Nueva mesa</button></TopbarSlot>
    <TopbarSlot name="sub"><div className="toolbar-audit">{selected ? <><strong>Mesa {selected.numero}</strong><span>{selected.fecha_creado && new Intl.DateTimeFormat('es-PY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(selected.fecha_creado))} · {selected.creado_por}</span></> : <span>Seleccioná una mesa para ver fecha y creador</span>}</div><div className="result-count">{total} {total === 1 ? 'mesa' : 'mesas'}</div></TopbarSlot>
    {error && <div className="alert error catalog-error">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th className="numeric-cell">Número</th><th className="numeric-cell">Capacidad</th><th>Ubicación</th><th>Estado</th><th className="actions-col">Acciones</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="5" className="table-loading"><div className="loader" />Cargando mesas…</td></tr> : items.length === 0 ? <tr><td colSpan="5" className="table-empty">No hay mesas que coincidan con la búsqueda.</td></tr> : items.map((item) => <tr key={item.idmesa} onClick={() => setSelectedId(item.idmesa)} className={`${!item.activa ? 'inactive-row ' : ''}${selectedId === item.idmesa ? 'selected-row' : ''}`}><td className="numeric-cell"><strong>{item.numero}</strong><small>ID {item.idmesa}</small></td><td className="numeric-cell">{item.capacidad}</td><td>{item.ubicacion}</td><td><label className="switch" onClick={(event) => event.stopPropagation()}><input aria-label={`Mesa ${item.numero} activa`} type="checkbox" checked={item.activa} onChange={() => toggle(item)} /><span className="slider" /></label><span className={`state-label ${item.activa ? 'on' : 'off'}`}>{item.activa ? 'Activa' : 'Inactiva'} · {item.estado}</span></td><td className="actions-col"><button className="edit-button" onClick={(event) => { event.stopPropagation(); setModal(item); }}>Editar</button></td></tr>)}
    </tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {page} de {totalPages}</span><div className="pagination"><button className="page-button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>Siguiente</button></div></div>
    {modal && <Modal item={modal.idmesa ? modal : null} locations={locations} onClose={() => setModal(null)} onSave={save} saving={saving} />}
  </div>;
}
