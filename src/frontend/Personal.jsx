import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';
import { api, mutate } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import MoneyInput from './MoneyInput.jsx';
import './rrhh.css';

// RR.HH. · Personal: datos básicos, forma de pago y límite de vales.
export const tiposPago = [['DIARIO', 'Diario', 'por día'], ['SEMANAL', 'Semanal', 'por semana'], ['QUINCENAL', 'Quincenal', 'por quincena'], ['MENSUAL', 'Mensual', 'por mes']];
const tipoLabel = tipo => tiposPago.find(([value]) => value === tipo) || [tipo, tipo, ''];
const blank = () => ({ nombre_completo: '', documento: '', telefono: '', fk_idcargo_personal: '', direccion: '', fecha_ingreso: '', tipo_pago: 'MENSUAL', monto_pago: '0', limite_monto_vale: '0', observacion: '', activo: true });

export default function Personal() {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 }), [search, setSearch] = useState(''), [estado, setEstado] = useState(''), [page, setPage] = useState(1), [pageSize, setSize] = useState(25);
  const [form, setForm] = useState(null), [selected, setSelected] = useState(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  // Cargos del catálogo (RR.HH. → Cargos): se vuelven a leer al abrir el formulario por si se agregó uno.
  const [cargos, setCargos] = useState([]);
  const loadCargos = () => api('/api/cargos-personal/opciones').then(result => setCargos(result.items)).catch(e => setError(e.message));
  const load = async () => { setLoading(true); try { setData(await api(`/api/personal?${new URLSearchParams({ search, estado, page, pageSize })}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [search, estado, page, pageSize]);
  useEffect(() => { if (form) loadCargos(); }, [form === null]);
  const perform = async fn => { if (busy) return; setBusy(true); setError(''); try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  const save = e => { e.preventDefault(); perform(async () => { const { cargo, ...body } = form; const result = await mutate(form.idpersonal ? `/api/personal/${form.idpersonal}` : '/api/personal', body, form.idpersonal ? 'PUT' : 'POST'); setSelected(result.item); setForm(null); }); };
  const toggle = item => perform(async () => { const { cargo, ...rest } = item; const result = await mutate(`/api/personal/${item.idpersonal}`, { ...rest, activo: !item.activo }, 'PUT'); setSelected(result.item); });
  const edit = item => { setError(''); setForm({ ...blank(), ...Object.fromEntries(Object.entries(item).map(([k, v]) => [k, v ?? ''])), monto_pago: String(Number(item.monto_pago || 0)), limite_monto_vale: String(Number(item.limite_monto_vale || 0)), activo: item.activo }); };
  const field = (key, label, max = 120, type = 'text') => <label key={key}>{label}<input type={type} maxLength={max} value={form[key] || ''} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>;
  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input placeholder="Buscar nombre, documento, cargo o teléfono…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div><label>Estado <select value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }}><option value="">Todos</option><option value="activo">Activos</option><option value="inactivo">Inactivos</option></select></label><button className="primary" onClick={() => { setError(''); setForm(blank()); }}>+ Nuevo personal</button></TopbarSlot>
    <TopbarSlot name="sub"><div className="toolbar-audit">{selected ? <><strong>{selected.nombre_completo}</strong><span>{new Date(selected.fecha_creado).toLocaleString('es-PY')} · {selected.creado_por}</span></> : <span>Seleccioná una persona para ver fecha y creador</span>}</div><span>{data.total} personas</span></TopbarSlot>
    {error && !form && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Nombre</th><th>Cargo</th><th>Teléfono</th><th>Forma de pago</th><th className="numeric-cell">Sueldo</th><th className="numeric-cell">Vales del mes</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan="8">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="8" className="table-empty">Sin personal</td></tr> : data.items.map(item => {
        const [, label, per] = tipoLabel(item.tipo_pago);
        const limite = Number(item.limite_monto_vale || 0);
        return <tr key={item.idpersonal} className={`${item.activo ? '' : 'inactive-row'} ${selected?.idpersonal === item.idpersonal ? 'selected-row' : ''}`} onClick={() => setSelected(item)}>
          <td><strong>{item.nombre_completo}</strong><small>{item.documento ? `Doc. ${item.documento}` : 'Sin documento'}{item.fecha_ingreso ? ` · ingreso ${item.fecha_ingreso.split('-').reverse().join('/')}` : ''}</small></td>
          <td>{item.cargo || '—'}</td><td>{item.telefono || '—'}</td>
          <td><span className={`pay-pill pay-${String(item.tipo_pago).toLowerCase()}`}>{label}</span></td>
          <td className="numeric-cell"><strong>{formatMoney(item.monto_pago)}</strong><small>{per}</small></td>
          <td className="numeric-cell"><strong>{formatMoney(item.vales_mes)}</strong><small>{limite ? `límite ${formatMoney(limite)} por vale` : 'sin límite por vale'}</small></td>
          <td><label className="switch" onClick={e => e.stopPropagation()}><input type="checkbox" checked={item.activo} disabled={busy} onChange={() => toggle(item)} /><span className="slider" /></label> {item.activo ? 'Activo' : 'Inactivo'}</td>
          <td><button className="edit-button" onClick={e => { e.stopPropagation(); edit(item); }}>Editar</button></td></tr>;
      })}</tbody></table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    {form && <div className="modal-backdrop"><div className="modal rrhh-modal" role="dialog" aria-modal="true" aria-label="Personal"><div className="modal-head"><h2>{form.idpersonal ? 'Editar' : 'Nuevo'} personal</h2><button className="modal-close" disabled={busy} onClick={() => setForm(null)}>×</button></div>
      <form className="modal-form" onSubmit={save}>
        <label>Nombre completo<input type="text" autoFocus required maxLength={120} value={form.nombre_completo} onChange={e => setForm({ ...form, nombre_completo: e.target.value })} /></label>
        <div className="form-grid">{field('documento', 'Documento (CI)', 40)}{field('telefono', 'Teléfono', 40)}
          <label>Cargo<select value={String(form.fk_idcargo_personal ?? '')} onChange={e => setForm({ ...form, fk_idcargo_personal: e.target.value })}>
            <option value="">Sin cargo</option>
            {cargos.filter(item => item.activo || String(item.idcargo_personal) === String(form.fk_idcargo_personal)).map(item => <option key={item.idcargo_personal} value={item.idcargo_personal}>{item.nombre}{item.activo ? '' : ' (inactivo)'}</option>)}
          </select>{!cargos.some(item => item.activo) && <small className="form-hint">Creá los cargos en RR.HH. → Cargos</small>}</label>
          {field('fecha_ingreso', 'Fecha de ingreso', 10, 'date')}</div>
        {field('direccion', 'Dirección', 250)}
        <fieldset className="rrhh-pay"><legend>Forma de pago</legend>
          <div className="rrhh-pay-options" role="radiogroup" aria-label="Forma de pago">{tiposPago.map(([value, label, per]) => <button type="button" key={value} role="radio" aria-checked={form.tipo_pago === value} className={form.tipo_pago === value ? 'active' : ''} onClick={() => setForm({ ...form, tipo_pago: value })}><strong>{label}</strong><small>{per}</small></button>)}</div>
          <div className="form-grid"><label>Sueldo {tipoLabel(form.tipo_pago)[2]}<MoneyInput min={0} value={form.monto_pago} onValueChange={value => setForm({ ...form, monto_pago: value })} /></label><label>Límite por vale<MoneyInput min={0} value={form.limite_monto_vale} onValueChange={value => setForm({ ...form, limite_monto_vale: value })} /><small className="form-hint">0 = sin límite</small></label></div>
        </fieldset>
        <label>Observación<textarea maxLength={500} rows="2" value={form.observacion || ''} onChange={e => setForm({ ...form, observacion: e.target.value })} /></label>
        <label className="check-label"><input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />Activo</label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
      </form></div></div>}
  </div>;
}
