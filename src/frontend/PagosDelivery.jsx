import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { api, mutate } from './pedidos-api.js';
import { formatInteger, formatMoney } from './formatters.js';
import FormaPagoBotones, { defaultFormId } from './FormaPagoBotones.jsx';
import { ExcelIcon, PdfIcon, PrinterIcon } from './ActionIcons.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';
import './pedidos.css';
import './kpi-pedidos.css';
import './kpi-gastos.css';
import './pagos-delivery.css';

// Caja y finanzas · Pagos a delivery: lo cobrado por delivery es del entregador.
// Muestra cuánto se le debe a cada uno en el período, permite pagarle (sale de la caja abierta como gasto
// "Pago a delivery"), anular pagos y asignar entregador a pedidos que no lo tienen.
const dateOnly = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialRange = () => { const fin = new Date(); const inicio = new Date(fin.getFullYear(), fin.getMonth(), 1); return { inicio: dateOnly(inicio), fin: dateOnly(fin), entregador: '' }; };
const queryOf = r => new URLSearchParams(Object.entries(r).filter(([, value]) => value !== '')).toString();
const dayText = iso => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—';
const ticketUrl = id => `/api/pagos-delivery/${id}/ticket.pdf`;

export default function PagosDelivery() {
  const feedback = useOperationFeedback();
  const [range, setRange] = useState(initialRange), [applied, setApplied] = useState(initialRange);
  const [data, setData] = useState(null), [options, setOptions] = useState({ entregadores: [], formas: [], caja_abierta: true });
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [paying, setPaying] = useState(null), [forma, setForma] = useState(''), [cancel, setCancel] = useState(null), [reason, setReason] = useState('');
  const [assign, setAssign] = useState({}), [showOrders, setShowOrders] = useState(false);

  const loadOptions = async () => { const opts = await api('/api/pagos-delivery/opciones'); setOptions(opts); return opts; };
  const load = async (filters = applied) => {
    setLoading(true);
    try { setData(await api(`/api/pagos-delivery?${queryOf(filters)}`)); setError(''); } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { loadOptions().catch(e => setError(e.message)); }, []);
  useEffect(() => { load(applied); }, [applied]);
  const submit = event => { event.preventDefault(); if (!range.inicio || !range.fin || range.inicio > range.fin) return setError('Ingresá un rango de fechas válido'); setApplied({ ...range }); };
  // Una operación: muestra el progreso, recarga y deja el mensaje final (fn puede devolver [mensaje, opciones]).
  const run = async (message, fn) => {
    if (busy) return;
    const feedbackId = feedback.begin(message);
    setBusy(true); setError('');
    try {
      const [done, extra] = (await fn()) || ['Listo.', {}];
      await Promise.all([load(), loadOptions()]);
      feedback.succeed(feedbackId, done, extra);
    } catch (e) { setError(e.message); feedback.fail(feedbackId, e.message); } finally { setBusy(false); }
  };
  const openPay = async courier => { setError(''); const opts = await loadOptions().catch(e => { setError(e.message); return options; }); setForma(defaultFormId(opts.formas)); setPaying(courier); };
  const pay = event => {
    event.preventDefault();
    run('Pagando al entregador…', async () => {
      const { pago } = await mutate('/api/pagos-delivery/pagar', { fk_identregador_delivery: paying.id, inicio: applied.inicio, fin: applied.fin, fk_idforma_pago: forma, total: paying.pendiente });
      setPaying(null);
      return [`Pago #${pago.idpago_delivery} a ${pago.entregador}: ${formatMoney(pago.total)} (${pago.pedidos.length} pedidos), descontado de la caja. ¿Imprimir el comprobante para que firme?`, { printUrl: ticketUrl(pago.idpago_delivery), timeoutMs: 10000 }];
    });
  };
  const annul = event => {
    event.preventDefault();
    run('Anulando pago…', async () => { await mutate(`/api/pagos-delivery/${cancel.idpago_delivery}/anular`, { motivo: reason }); setCancel(null); setReason(''); return ['Pago anulado: la plata volvió a la caja y los pedidos quedaron pendientes.', {}]; });
  };
  const assignCourier = pedido => run('Asignando entregador…', async () => { const result = await mutate(`/api/pagos-delivery/pedidos/${pedido.idpedido}/entregador`, { fk_identregador_delivery: assign[pedido.idpedido] }); return [`Pedido #${result.idpedido} asignado a ${result.entregador}.`, {}]; });

  const s = data?.resumen;
  const exportQuery = queryOf(applied);
  const blockIfBusy = event => { if (!data || loading) event.preventDefault(); };
  const activeCouriers = options.entregadores.filter(e => e.activo);
  return <div className="kpi-page delivery-pay-page">
    <TopbarSlot><form className="kpi-filters" onSubmit={submit}>
      <label>Desde<input type="date" required value={range.inicio} onChange={e => setRange({ ...range, inicio: e.target.value })} /></label>
      <label>Hasta<input type="date" required value={range.fin} onChange={e => setRange({ ...range, fin: e.target.value })} /></label>
      <label>Entregador<select className="kpi-filter-select" value={range.entregador} onChange={e => setRange({ ...range, entregador: e.target.value })}><option value="">Todos</option>{options.entregadores.map(e => <option key={e.id} value={e.id}>{e.nombre}{e.activo ? '' : ' (inactivo)'}</option>)}</select></label>
      <button className="primary" disabled={loading}>Aplicar</button>
      <div className="kpi-export" aria-label="Exportar">
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/pagos-delivery/reporte.xlsx?${exportQuery}`} download aria-disabled={!data || loading} onClick={blockIfBusy} title="Descargar Excel"><ExcelIcon /><span>Excel</span></a>
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/pagos-delivery/reporte.pdf?${exportQuery}`} target="_blank" rel="noopener noreferrer" aria-disabled={!data || loading} onClick={blockIfBusy} title="Abrir PDF"><PdfIcon /><span>PDF</span></a>
      </div>
    </form></TopbarSlot>
    {error && !paying && !cancel && <div className="alert error" role="alert">{error}</div>}
    {!options.caja_abierta && <div className="alert delivery-warning" role="status">No hay una caja abierta: abrila en Caja general para poder pagar o anular pagos.</div>}
    {loading && !data && <div className="empty-state"><div className="loader" />Cargando…</div>}
    {data && <>
      <div className="kpi-summary expense-kpi-summary">
        <div><span>Delivery del período</span><strong>{formatMoney(s.total)}</strong><small>{formatInteger(s.pedidos)} pedidos con entregador</small></div>
        <div><span>Ya pagado</span><strong>{formatMoney(s.pagado)}</strong><small>Pagado a los entregadores</small></div>
        <div className={s.pendiente ? 'delivery-due' : ''}><span>Pendiente de pagar</span><strong>{formatMoney(s.pendiente)}</strong><small>Se le debe a los entregadores</small></div>
        <div><span>Sin entregador</span><strong>{formatMoney(s.sin_entregador.total)}</strong><small>{formatInteger(s.sin_entregador.pedidos)} pedidos sin asignar</small></div>
      </div>

      <article className="kpi-panel">
        <div className="kpi-panel-heading"><div><h3>Por entregador</h3><p>Delivery de pedidos confirmados del {dayText(applied.inicio)} al {dayText(applied.fin)} (sin anulados). Pagar incluye todos los pendientes del período.</p></div></div>
        <div className="catalog-table-wrap delivery-table-wrap"><table className="catalog-table"><thead><tr><th>Entregador</th><th className="numeric-cell">Pedidos</th><th className="numeric-cell">Delivery</th><th className="numeric-cell">Pagado</th><th className="numeric-cell">Pendiente</th><th /></tr></thead>
          <tbody>{!data.entregadores.length ? <tr><td colSpan="6" className="table-empty">Sin pedidos delivery con entregador en el período</td></tr> : data.entregadores.map(e => <tr key={e.id}>
            <td><strong>{e.nombre}</strong></td><td className="numeric-cell">{formatInteger(e.pedidos)}</td><td className="numeric-cell">{formatMoney(e.total)}</td>
            <td className="numeric-cell">{formatMoney(e.pagado)}</td><td className="numeric-cell"><strong className={e.pendiente ? 'delivery-due-text' : ''}>{formatMoney(e.pendiente)}</strong>{e.pendientes > 0 && <small>{e.pendientes} pedidos</small>}</td>
            <td><button className="primary delivery-pay-button" disabled={busy || !e.pendiente || !options.caja_abierta} onClick={() => openPay(e)}>Pagar</button></td>
          </tr>)}</tbody></table></div>
      </article>

      {data.sin_entregador.length > 0 && <article className="kpi-panel delivery-unassigned">
        <div className="kpi-panel-heading"><div><h3>Pedidos sin entregador ({data.sin_entregador.length})</h3><p>Su delivery ({formatMoney(s.sin_entregador.total)}) no se le puede pagar a nadie hasta asignarles quién los entregó.</p></div></div>
        <div className="catalog-table-wrap delivery-table-wrap"><table className="catalog-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Zona</th><th className="numeric-cell">Delivery</th><th>Asignar entregador</th></tr></thead>
          <tbody>{data.sin_entregador.map(p => <tr key={p.idpedido}>
            <td><strong>#{p.idpedido}</strong><small>{dayText(p.fecha)} {p.hora}</small></td><td>{p.cliente}<small>{p.direccion_entrega || ''}</small></td><td>{p.zona_nombre || '—'}</td>
            <td className="numeric-cell">{formatMoney(p.monto_delivery)}</td>
            <td><div className="delivery-assign"><select value={assign[p.idpedido] || ''} onChange={e => setAssign({ ...assign, [p.idpedido]: e.target.value })}><option value="">Elegir…</option>{activeCouriers.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select><button className="secondary" disabled={busy || !assign[p.idpedido]} onClick={() => assignCourier(p)}>Asignar</button></div></td>
          </tr>)}</tbody></table></div>
      </article>}

      <article className="kpi-panel">
        <div className="kpi-panel-heading delivery-heading"><div><h3>Pedidos delivery ({data.pedidos.length})</h3><p>Detalle de cada pedido del período y si ya se le pagó al entregador.</p></div><button className="secondary" onClick={() => setShowOrders(!showOrders)}>{showOrders ? 'Ocultar' : 'Ver pedidos'}</button></div>
        {showOrders && <div className="catalog-table-wrap delivery-table-wrap"><table className="catalog-table"><thead><tr><th>Pedido</th><th>Entregador</th><th>Cliente</th><th>Zona</th><th>Situación</th><th className="numeric-cell">Delivery</th></tr></thead>
          <tbody>{!data.pedidos.length ? <tr><td colSpan="6" className="table-empty">Sin pedidos</td></tr> : data.pedidos.map(p => <tr key={p.idpedido} className={p.pagado ? 'inactive-row' : ''}>
            <td><strong>#{p.idpedido}</strong><small>{dayText(p.fecha)} {p.hora}</small></td><td>{p.entregador}</td><td>{p.cliente}</td><td>{p.zona_nombre || '—'}</td>
            <td>{p.pagado ? <span className="delivery-pill paid">Pagado · #{p.idpago_delivery}</span> : <span className="delivery-pill due">Pendiente</span>}{p.estado !== 'pagado' && <small>El cliente aún no pagó</small>}</td>
            <td className="numeric-cell">{formatMoney(p.monto_delivery)}</td>
          </tr>)}</tbody></table></div>}
      </article>

      <article className="kpi-panel">
        <div className="kpi-panel-heading"><div><h3>Pagos realizados</h3><p>Registrados en el período. Cada pago salió de la caja como gasto "Pago a delivery"; los anulados volvieron a la caja.</p></div></div>
        <div className="catalog-table-wrap delivery-table-wrap"><table className="catalog-table"><thead><tr><th>Pago</th><th>Entregador</th><th>Período</th><th className="numeric-cell">Pedidos</th><th>Forma de pago</th><th className="numeric-cell">Total</th><th>Estado</th><th>Acciones</th></tr></thead>
          <tbody>{!data.pagos.length ? <tr><td colSpan="8" className="table-empty">Sin pagos en el período</td></tr> : data.pagos.map(p => <tr key={p.idpago_delivery} className={p.estado === 'anulado' ? 'inactive-row' : ''}>
            <td><strong>#{p.idpago_delivery}</strong><small>{p.fecha.slice(8, 10)}/{p.fecha.slice(5, 7)} {p.fecha.slice(11)} · {p.creado_por}</small></td><td>{p.entregador}</td>
            <td>{dayText(p.fecha_desde)} al {dayText(p.fecha_hasta)}</td><td className="numeric-cell">{formatInteger(p.cantidad_pedidos)}</td><td>{p.forma_pago}</td>
            <td className="numeric-cell"><strong>{formatMoney(p.total)}</strong></td>
            <td>{p.estado === 'anulado' ? 'Anulado' : 'Pagado'}{p.motivo_anulado && <small>Motivo: {p.motivo_anulado}</small>}</td>
            <td><div className="order-list-actions"><a className="edit-button ticket-link order-action-icon" href={ticketUrl(p.idpago_delivery)} target="_blank" rel="noopener noreferrer" aria-label={`Imprimir comprobante del pago #${p.idpago_delivery}`} title="Imprimir comprobante"><PrinterIcon /></a>{p.estado !== 'anulado' && <button className="edit-button" disabled={busy || !options.caja_abierta} onClick={() => { setError(''); setReason(''); setCancel(p); }}>Anular</button>}</div></td>
          </tr>)}</tbody></table></div>
      </article>
      <p className="kpi-footnote">El delivery de cada pedido es lo que se cobró al cliente según su zona. Lo cobrado entra a la caja junto con el pedido, pero es del entregador: hasta pagarlo, Caja general lo muestra como "Delivery por pagar a entregadores".</p>
    </>}

    {paying && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Pagar al entregador"><div className="modal-head"><h2>Pagar a {paying.nombre}</h2><button className="modal-close" disabled={busy} onClick={() => setPaying(null)}>×</button></div>
      <form className="modal-form" onSubmit={pay}>
        <p className="delivery-pay-total"><span>{paying.pendientes} pedidos del {dayText(applied.inicio)} al {dayText(applied.fin)}</span><strong>{formatMoney(paying.pendiente)}</strong></p>
        <div className="payment-field"><span>Forma de pago</span><FormaPagoBotones forms={options.formas} value={forma} onChange={setForma} /></div>
        <p className="form-hint">Sale de la caja abierta como gasto "Pago a delivery". Después podés imprimir el comprobante para que firme el entregador.</p>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setPaying(null)}>Cancelar</button><button className="primary" disabled={busy || !forma}>{busy ? 'Pagando…' : `Pagar ${formatMoney(paying.pendiente)}`}</button></div>
      </form></div></div>}

    {cancel && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Anular pago a delivery"><div className="modal-head"><h2>Anular pago #{cancel.idpago_delivery}</h2><button className="modal-close" disabled={busy} onClick={() => setCancel(null)}>×</button></div>
      <form className="modal-form" onSubmit={annul}><p className="muted">{cancel.entregador} · {formatMoney(cancel.total)} · {cancel.cantidad_pedidos} pedidos. La plata vuelve a la caja abierta ({cancel.forma_pago}) y los pedidos quedan pendientes de pago otra vez.</p>
        <label>Motivo<textarea required autoFocus maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setCancel(null)}>Cancelar</button><button className="primary danger" disabled={busy}>{busy ? 'Anulando…' : 'Anular pago'}</button></div>
      </form></div></div>}
  </div>;
}
