import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';
import { api, mutate } from './pedidos-api.js';
import './rrhh.css';

// RR.HH. · Cargos: catálogo del personal sin duplicados (único sin distinguir mayúsculas).
const clean = value => value.trim().replace(/\s+/g, ' ');

export default function Cargos() {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const load = async () => { setLoading(true); try { setData(await api(`/api/cargos-personal?${new URLSearchParams({ search, page, pageSize })}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [search, page, pageSize]);
  const perform = async fn => { if (busy) return; setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const save = event => { event.preventDefault(); perform(async () => { const body = { nombre: clean(form.nombre), activo: form.activo }; const result = await mutate(form.idcargo_personal ? `/api/cargos-personal/${form.idcargo_personal}` : '/api/cargos-personal', body, form.idcargo_personal ? 'PUT' : 'POST'); setSelected(result.item); setForm(null); }); };
  const toggle = item => perform(async () => { const result = await mutate(`/api/cargos-personal/${item.idcargo_personal}`, { nombre: item.nombre, activo: !item.activo }, 'PUT'); setSelected(result.item); });
  const move = (item, direction) => perform(() => mutate(`/api/cargos-personal/${item.idcargo_personal}/orden`, { direction }));
  // Aviso mientras se escribe: un cargo con el mismo nombre (sin mayúsculas ni espacios de más) ya está en la página.
  const twin = form && clean(form.nombre) && data.items.find(item => item.idcargo_personal !== form.idcargo_personal && item.nombre.toLowerCase() === clean(form.nombre).toLowerCase());
  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input placeholder="Buscar cargo…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><button className="primary" onClick={() => { setError(''); setForm({ nombre: '', activo: true }); }}>+ Nuevo cargo</button></TopbarSlot>
    <TopbarSlot name="sub"><div className="toolbar-audit">{selected ? <><strong>{selected.nombre}</strong><span>{new Date(selected.fecha_creado).toLocaleString('es-PY')} · {selected.creado_por}</span></> : <span>Seleccioná una fila para ver fecha y creador</span>}</div><span>{data.total} cargos</span></TopbarSlot>
    {error && !form && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Cargo</th><th className="numeric-cell">Personas</th><th>Orden</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="5">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="5" className="table-empty">Sin cargos</td></tr> : data.items.map((item, index) => <tr key={item.idcargo_personal} className={`${item.activo ? '' : 'inactive-row'} ${selected?.idcargo_personal === item.idcargo_personal ? 'selected-row' : ''}`} onClick={() => setSelected(item)}>
        <td><strong>{item.nombre}</strong></td>
        <td className="numeric-cell">{item.personas}{item.personas !== item.personas_activas && <small>{item.personas_activas} activas</small>}</td>
        <td>{item.orden} <button className="order-button" aria-label={`Subir ${item.nombre}`} disabled={busy || (page === 1 && index === 0)} onClick={e => { e.stopPropagation(); move(item, 'up'); }}>↑</button> <button className="order-button" aria-label={`Bajar ${item.nombre}`} disabled={busy || (page === data.totalPages && index === data.items.length - 1)} onClick={e => { e.stopPropagation(); move(item, 'down'); }}>↓</button></td>
        <td><label className="switch" onClick={e => e.stopPropagation()}><input type="checkbox" checked={item.activo} disabled={busy} onChange={() => toggle(item)} /><span className="slider" /></label> {item.activo ? 'Activo' : 'Inactivo'}</td>
        <td><button className="edit-button" onClick={e => { e.stopPropagation(); setError(''); setForm({ ...item }); }}>Editar</button></td>
      </tr>)}
    </tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    {form && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Cargo"><div className="modal-head"><h2>{form.idcargo_personal ? 'Editar' : 'Nuevo'} cargo</h2><button className="modal-close" disabled={busy} onClick={() => setForm(null)}>×</button></div>
      <form className="modal-form" onSubmit={save}>
        <label>Nombre<input autoFocus required maxLength={80} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />{twin ? <small className="form-hint form-hint-warning">Ya existe el cargo "{twin.nombre}"</small> : <small className="form-hint">No se distinguen mayúsculas: "Cocinera" y "COCINERA" son el mismo cargo.</small>}</label>
        {form.idcargo_personal && form.personas > 0 && <p className="form-hint">Lo usan {form.personas} {form.personas === 1 ? 'persona' : 'personas'}; el cambio de nombre se ve en todas.</p>}
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />Activo (los inactivos no se ofrecen para personal nuevo)</label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={busy || !!twin}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form></div></div>}
  </div>;
}
