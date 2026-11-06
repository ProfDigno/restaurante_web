import TopbarSlot from './TopbarSlot.jsx';
import { useEffect, useState } from 'react';
import { api, mutate } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import MoneyInput from './MoneyInput.jsx';
import FormaPagoBotones, { defaultFormId } from './FormaPagoBotones.jsx';
import { PrinterIcon } from './ActionIcons.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';
import './pedidos.css';
import './gastos.css';
import './rrhh.css';

// RR.HH. · Vales: adelantos al personal que salen de la caja abierta; se pueden anular (con reversión en caja).
const dateTime = value => value ? new Date(value).toLocaleString('es-PY') : '—';
const ticketUrl = id => `/api/vales/${id}/ticket.pdf`;
const emptyForm = () => ({ fk_idpersonal: '', fk_idforma_pago: '', monto_vale: '', descripcion: '' });

export default function Vales() {
  const feedback = useOperationFeedback();
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, resumen: { pagados: 0, monto_pagado: 0, anulados: 0, monto_anulado: 0 } });
  const [options, setOptions] = useState({ personal: [], formas: [], caja_abierta: true });
  const [search, setSearch] = useState(''), [inicio, setInicio] = useState(''), [fin, setFin] = useState(''), [personal, setPersonal] = useState(''), [estado, setEstado] = useState('');
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25), [form, setForm] = useState(null), [cancel, setCancel] = useState(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const load = async () => { setLoading(true); try { setData(await api(`/api/vales?${new URLSearchParams({ search, inicio, fin, personal, estado, page, pageSize })}`)); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  useEffect(() => { load(); }, [search, inicio, fin, personal, estado, page, pageSize]);
  const loadOptions = async () => { const opts = await api('/api/vales/opciones'); setOptions(opts); return opts; };
  useEffect(() => { loadOptions().catch(e => setError(e.message)); }, []);
  const open = async () => { setError(''); try { const opts = await loadOptions(); setForm({ ...emptyForm(), fk_idforma_pago: defaultFormId(opts.formas) }); } catch (e) { setError(e.message); } };
  const persona = options.personal.find(p => String(p.idpersonal) === String(form?.fk_idpersonal));
  const limite = Number(persona?.limite_monto_vale || 0);
  // Al guardar, un solo mensaje confirma el vale y ofrece IMPRIMIR el comprobante para firmar.
  const save = async event => {
    event.preventDefault(); if (busy) return;
    const feedbackId = feedback.begin('Registrando vale…'); setBusy(true); setError('');
    try {
      const { item } = await mutate('/api/vales', form); setForm(null); await load();
      feedback.succeed(feedbackId, `Vale #${item.idvale} de ${formatMoney(item.monto_vale)} a ${item.personal_nombre} registrado y descontado de caja. ¿Querés imprimir el comprobante para firmar?`, { printUrl: ticketUrl(item.idvale), timeoutMs: 10000 });
    } catch (e) { setError(e.message); feedback.fail(feedbackId, e.message); } finally { setBusy(false); }
  };
  const annul = async event => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await mutate(`/api/vales/${cancel.idvale}/anular`, { motivo: reason }); setCancel(null); setReason(''); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const r = data.resumen;
  return <div className="catalog-page">
    <TopbarSlot><div className="search-box"><span>⌕</span><input placeholder="Buscar persona o concepto…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></div>
      <button className="primary" onClick={open}>+ Registrar vale</button></TopbarSlot>
    <TopbarSlot name="sub"><span>{data.total} vales · pagados {formatMoney(r.monto_pagado)}{r.anulados ? ` · anulados ${formatMoney(r.monto_anulado)}` : ''}</span></TopbarSlot>
    <div className="rrhh-filters">
      <label>Desde<input type="date" value={inicio} onChange={e => { setInicio(e.target.value); setPage(1); }} /></label><label>Hasta<input type="date" value={fin} onChange={e => { setFin(e.target.value); setPage(1); }} /></label>
      <label>Personal<select value={personal} onChange={e => { setPersonal(e.target.value); setPage(1); }}><option value="">Todos</option>{options.personal.map(p => <option key={p.idpersonal} value={p.idpersonal}>{p.nombre_completo}{p.activo ? '' : ' (inactivo)'}</option>)}</select></label>
      <label>Estado<select value={estado} onChange={e => { setEstado(e.target.value); setPage(1); }}><option value="">Todos</option><option value="pagado">Pagados</option><option value="anulado">Anulados</option></select></label>
    </div>
    {!options.caja_abierta && <div className="alert rrhh-warning" role="status">No hay una caja abierta: abrila en Caja general para poder registrar o anular vales.</div>}
    {error && !form && !cancel && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table expense-table"><thead><tr><th>Fecha</th><th>Personal</th><th>Concepto</th><th>Forma de pago</th><th className="numeric-cell">Monto</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan="7">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="7" className="table-empty">Sin vales para estos filtros</td></tr> : data.items.map(item => <tr key={item.idvale} className={item.estado === 'anulado' ? 'inactive-row' : ''}>
        <td>{dateTime(item.fecha_vale)}<small>#{item.idvale} · {item.creado_por}</small></td>
        <td><strong>{item.personal_nombre}</strong><small>{item.personal_cargo || ''}</small></td>
        <td>{item.descripcion}{item.motivo_anulado && <small>Motivo: {item.motivo_anulado}</small>}</td>
        <td>{item.forma_pago_nombre}</td>
        <td className="numeric-cell"><strong>{formatMoney(item.monto_vale)}</strong></td>
        <td>{item.estado === 'anulado' ? 'Anulado' : 'Pagado'}</td>
        <td><div className="order-list-actions"><a className="edit-button ticket-link order-action-icon" href={ticketUrl(item.idvale)} target="_blank" rel="noopener noreferrer" aria-label={`Imprimir comprobante del vale #${item.idvale}`} title="Imprimir comprobante"><PrinterIcon /></a>{item.estado !== 'anulado' && <button className="edit-button" onClick={() => { setError(''); setReason(''); setCancel(item); }}>Anular</button>}</div></td>
      </tr>)}</tbody>
      {data.items.length > 0 && <tfoot><tr className="rrhh-total-row"><td colSpan="4">Total pagado (según filtros, {r.pagados} vales)</td><td className="numeric-cell">{formatMoney(r.monto_pagado)}</td><td colSpan="2" /></tr></tfoot>}
    </table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
    {form && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Registrar vale"><div className="modal-head"><h2>Registrar vale</h2><button className="modal-close" disabled={busy} onClick={() => setForm(null)}>×</button></div>
      <form className="modal-form" onSubmit={save}>
        <label>Personal<select required value={form.fk_idpersonal} onChange={e => setForm({ ...form, fk_idpersonal: e.target.value })}><option value="">Seleccionar</option>{options.personal.filter(p => p.activo).map(p => <option key={p.idpersonal} value={p.idpersonal}>{p.nombre_completo}{p.cargo ? ` · ${p.cargo}` : ''}</option>)}</select></label>
        <div className="payment-field"><span>Forma de pago</span><FormaPagoBotones forms={options.formas} value={form.fk_idforma_pago} onChange={value => setForm({ ...form, fk_idforma_pago: value })} /></div>
        <label>Monto<MoneyInput required min={1} max={limite || undefined} value={form.monto_vale} onValueChange={value => setForm({ ...form, monto_vale: value })} />{persona && <small className="form-hint">{limite ? `Límite por vale: ${formatMoney(limite)}` : 'Sin límite por vale'}</small>}</label>
        <label>Concepto (opcional)<input type="text" maxLength={500} placeholder={persona ? `Vale a ${persona.nombre_completo}` : 'Adelanto de sueldo'} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></label>
        <p className="form-hint">Se registrará como pagado y descontará el monto de Caja.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setForm(null)}>Cancelar</button><button className="primary" disabled={busy || !form.fk_idforma_pago}>{busy ? 'Registrando…' : 'Registrar vale'}</button></div>
      </form></div></div>}
    {cancel && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Anular vale"><div className="modal-head"><h2>Anular vale #{cancel.idvale}</h2><button className="modal-close" disabled={busy} onClick={() => setCancel(null)}>×</button></div>
      <form className="modal-form" onSubmit={annul}><p className="muted">{cancel.personal_nombre} · {formatMoney(cancel.monto_vale)}. Se registrará la reversión en la caja abierta (vuelve el dinero a {cancel.forma_pago_nombre}).</p>
        <label>Motivo<textarea required autoFocus maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setCancel(null)}>Cancelar</button><button className="primary danger" disabled={busy}>{busy ? 'Anulando…' : 'Anular vale'}</button></div>
      </form></div></div>}
  </div>;
}
