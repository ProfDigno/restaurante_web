import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';
import { api, mutate } from './pedidos-api.js';
import './rrhh.css';

// Caja y finanzas · Máquinas POS: catálogo de máquinas de tarjeta (nombre, número y estado).
// Nombre y número son únicos sin distinguir mayúsculas.
const clean = value => value.trim().replace(/\s+/g, ' ');
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();

export default function MaquinaPos() {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState(null), [form, setForm] = useState(null), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const load = async () => { setLoading(true); try { setData(await api(`/api/maquinas-pos?${new URLSearchParams({ search, page, pageSize })}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [search, page, pageSize]);
  const perform = async fn => { if (busy) return; setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const save = event => { event.preventDefault(); perform(async () => { const body = { nombre: clean(form.nombre), numero: clean(form.numero), activo: form.activo }; const result = await mutate(form.idmaquina_pos ? `/api/maquinas-pos/${form.idmaquina_pos}` : '/api/maquinas-pos', body, form.idmaquina_pos ? 'PUT' : 'POST'); setSelected(result.item); setForm(null); }); };
  const toggle = item => perform(async () => { const result = await mutate(`/api/maquinas-pos/${item.idmaquina_pos}`, { nombre: item.nombre, numero: item.numero, activo: !item.activo }, 'PUT'); setSelected(result.item); });
  const move = (item, direction) => perform(() => mutate(`/api/maquinas-pos/${item.idmaquina_pos}/orden`, { direction }));
  // Aviso mientras se escribe si el nombre o el número ya están en la página.
  const others = form ? data.items.filter(item => item.idmaquina_pos !== form.idmaquina_pos) : [];
  const twinName = form && clean(form.nombre) && others.find(item => same(item.nombre, form.nombre));
  const twinNumber = form && clean(form.numero) && others.find(item => same(item.numero, form.numero));
  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input placeholder="Buscar por nombre o número…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><button className="primary" onClick={() => { setError(''); setForm({ nombre: '', numero: '', activo: true }); }}>+ Nueva máquina POS</button></TopbarSlot>
    <TopbarSlot name="sub"><div className="toolbar-audit">{selected ? <><strong>{selected.nombre}</strong><span>{new Date(selected.fecha_creado).toLocaleString('es-PY')} · {selected.creado_por}</span></> : <span>Seleccioná una fila para ver fecha y creador</span>}</div><span>{data.total} máquinas POS</span></TopbarSlot>
    {error && !form && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Nombre</th><th>Número</th><th>Orden</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="5">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="5" className="table-empty">Sin máquinas POS</td></tr> : data.items.map((item, index) => <tr key={item.idmaquina_pos} className={`${item.activo ? '' : 'inactive-row'} ${selected?.idmaquina_pos === item.idmaquina_pos ? 'selected-row' : ''}`} onClick={() => setSelected(item)}>
        <td><strong>{item.nombre}</strong></td>
        <td>{item.numero}</td>
        <td>{item.orden} <button className="order-button" aria-label={`Subir ${item.nombre}`} disabled={busy || (page === 1 && index === 0)} onClick={e => { e.stopPropagation(); move(item, 'up'); }}>↑</button> <button className="order-button" aria-label={`Bajar ${item.nombre}`} disabled={busy || (page === data.totalPages && index === data.items.length - 1)} onClick={e => { e.stopPropagation(); move(item, 'down'); }}>↓</button></td>
        <td><label className="switch" onClick={e => e.stopPropagation()}><input type="checkbox" aria-label={`Activo ${item.nombre}`} checked={item.activo} disabled={busy} onChange={() => toggle(item)} /><span className="slider" /></label> {item.activo ? 'Activo' : 'Inactivo'}</td>
        <td><button className="edit-button" onClick={e => { e.stopPropagation(); setError(''); setForm({ ...item }); }}>Editar</button></td>
      </tr>)}
    </tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    {form && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Máquina POS"><div className="modal-head"><h2>{form.idmaquina_pos ? 'Editar' : 'Nueva'} máquina POS</h2><button className="modal-close" disabled={busy} onClick={() => setForm(null)}>×</button></div>
      <form className="modal-form" onSubmit={save}>
        <label>Nombre<input autoFocus required maxLength={80} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />{twinName && <small className="form-hint form-hint-warning">Ya existe la máquina POS "{twinName.nombre}"</small>}</label>
        <label>Número<input required maxLength={40} value={form.numero} onChange={e => setForm({ ...form, numero: e.target.value })} />{twinNumber ? <small className="form-hint form-hint-warning">El número {twinNumber.numero} ya lo tiene "{twinNumber.nombre}"</small> : <small className="form-hint">Número de terminal o de serie de la máquina.</small>}</label>
        {!form.idmaquina_pos && <p className="form-hint">El orden se asignará al final de la lista.</p>}
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />Activo</label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={busy || !!twinName || !!twinNumber}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form></div></div>}
  </div>;
}
