import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import MoneyInput from './MoneyInput.jsx';
import { formatInteger, formatMoney } from './formatters.js';
import { api } from './pedidos-api.js';

const numericFields = [['stock_actual', 'Stock actual'], ['stock_minimo', 'Stock mínimo'], ['precio_compra', 'Precio de compra'], ['precio_venta', 'Precio de venta']];
const dateTime = (value) => value ? new Intl.DateTimeFormat('es-PY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

function InsumoModal({ item, units, saving, onClose, onSave }) {
  const [form, setForm] = useState({
    nombre: item?.nombre || '', fk_idunidad_medida: item?.fk_idunidad_medida || '',
    ...Object.fromEntries(numericFields.map(([key]) => [key, item?.[key] ?? 0])),
    activo: item?.activo ?? true
  });
  const [error, setError] = useState('');
  const update = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    try {
      await onSave({ ...form, fk_idunidad_medida: Number(form.fk_idunidad_medida),
        ...Object.fromEntries(numericFields.map(([key]) => [key, Number(form[key])])) }, item?.idinsumo);
      onClose();
    } catch (reason) { setError(reason.message); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="modal product-modal" role="dialog" aria-modal="true" aria-labelledby="insumo-modal-title">
      <div className="modal-head"><div><p className="eyebrow">{item ? 'EDITAR' : 'NUEVO INSUMO'}</p><h2 id="insumo-modal-title">{item ? 'Editar insumo' : 'Crear insumo'}</h2></div><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div>
      <form className="modal-form" onSubmit={submit}>
        <label>Nombre<input autoFocus value={form.nombre} onChange={(event) => update('nombre', event.target.value)} maxLength={120} required /></label>
        <div className="form-grid">
          <label>Unidad de medida<select value={form.fk_idunidad_medida} onChange={(event) => update('fk_idunidad_medida', event.target.value)} required><option value="">Seleccioná…</option>{units.map((unit) => <option key={unit.idunidad_medida} value={unit.idunidad_medida}>{unit.codigo} · {unit.nombre}</option>)}</select></label>
          {numericFields.map(([key, label]) => <label key={key}>{label}{key.startsWith('precio_')
            ? <MoneyInput min={0} value={form[key]} onValueChange={(value) => update(key, value)} required />
            : <input type="number" min="0" step="1" value={form[key]} onChange={(event) => update(key, event.target.value)} required />}</label>)}
        </div>
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={(event) => update('activo', event.target.checked)} /> Insumo activo</label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar insumo'}</button></div>
      </form>
    </div>
  </div>;
}

export default function Insumo() {
  const [items, setItems] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api(`/api/insumos?${new URLSearchParams({ search, page, pageSize })}`)
      .then((data) => { if (!active) return; setItems(data.items); setTotal(data.total); setTotalPages(data.totalPages); setError(''); })
      .catch((reason) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [search, page, pageSize, version]);
  useEffect(() => { api('/api/unidades-medida?pageSize=100').then((data) => setUnits(data.items)).catch((reason) => setError(reason.message)); }, []);

  const save = async (values, id) => {
    setSaving(true);
    try {
      await api(id ? `/api/insumos/${id}` : '/api/insumos', { method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      setVersion((current) => current + 1);
    } finally { setSaving(false); }
  };
  const toggle = async (item) => {
    setError('');
    try { await save({ ...item, activo: !item.activo }, item.idinsumo); }
    catch (reason) { setError(reason.message); }
  };
  const selected = items.find((item) => item.idinsumo === selectedId);

  return <div className="catalog-page">
    <TopbarSlot>
      <div className="search-box"><span>⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar por nombre o unidad…" /></div>
      <button className="primary" onClick={() => setModal({})}>+ Nuevo insumo</button>
    </TopbarSlot>
    <TopbarSlot name="sub">
      <div className="toolbar-audit">{selected ? <><strong>{selected.nombre}</strong><span>{dateTime(selected.fecha_creado)} · {selected.creado_por}</span></> : <span>Seleccioná un insumo para ver fecha y creador</span>}</div>
      <div className="result-count">{total} {total === 1 ? 'insumo' : 'insumos'}</div>
    </TopbarSlot>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table">
      <thead><tr><th>Nombre</th><th>Unidad</th><th className="numeric-cell">Precio compra</th><th className="numeric-cell">Precio venta</th><th className="numeric-cell">Stock actual</th><th>Estado</th><th className="actions-col">Acciones</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan="7" className="table-loading">Cargando insumos…</td></tr>
        : items.length === 0 ? <tr><td colSpan="7" className="table-empty">No hay insumos.</td></tr>
        : items.map((item) => <tr key={item.idinsumo} onClick={() => setSelectedId(item.idinsumo)} className={item.activo ? '' : 'inactive-row'}>
          <td><strong>{item.nombre}</strong><small>ID {item.idinsumo}</small></td>
          <td>{item.unidad_codigo} · {item.unidad_nombre}</td>
          <td className="numeric-cell">{formatMoney(item.precio_compra)}</td>
          <td className="numeric-cell">{formatMoney(item.precio_venta)}</td>
          <td className="numeric-cell">{formatInteger(item.stock_actual)}</td>
          <td><label className="switch"><input type="checkbox" checked={item.activo} disabled={saving} onChange={() => toggle(item)} /><span className="slider" /></label><span className={`state-label ${item.activo ? 'on' : 'off'}`}>{item.activo ? 'Activo' : 'Inactivo'}</span></td>
          <td className="actions-col"><button className="edit-button" onClick={(event) => { event.stopPropagation(); setModal(item); }}>Editar</button></td>
        </tr>)}</tbody>
    </table></div>
    <div className="catalog-footer">
      <label>Mostrar <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label>
      <span>Página {page} de {totalPages}</span>
      <div className="pagination"><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    </div>
    {modal && <InsumoModal item={modal.idinsumo ? modal : null} units={units} saving={saving} onClose={() => setModal(null)} onSave={save} />}
  </div>;
}
