import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { api, mutate } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import MoneyInput from './MoneyInput.jsx';
import PedidoErrorDialog from './PedidoErrorDialog.jsx';
import { EyeIcon, PrinterIcon } from './ActionIcons.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';
import './caja.css';

const dateTime = (value) => value ? new Date(value).toLocaleString('es-PY') : '—';

export function CajaOpenForm({ onOpened, gate = false, user, onLogout }) {
  const feedback = useOperationFeedback();
  const [amount, setAmount] = useState('0');
  const [cashName, setCashName] = useState('efectivo');
  useEffect(() => { let current = true; api('/api/cajas/estado').then((state) => current && state.efectivo?.nombre && setCashName(state.efectivo.nombre.toLowerCase())).catch(() => {}); return () => { current = false; }; }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault();
    const feedbackId = feedback.begin('Abriendo caja…');
    setBusy(true); setError('');
    try {
      const result = await mutate('/api/cajas/abrir', { monto_inicial: amount });
      feedback.succeed(feedbackId, 'Caja abierta correctamente.');
      onOpened?.(result);
    } catch (e) {
      try {
        const state = await api('/api/cajas/estado');
        if (state.caja) { feedback.succeed(feedbackId, 'La caja ya fue abierta.'); onOpened?.(state.caja); return; }
      } catch { /* Preserve the opening error. */ }
      setError(e.message); feedback.fail(feedbackId, e.message);
    } finally { setBusy(false); }
  };
  const form = <form className="cash-open-form" onSubmit={submit}>
    <div className="cash-symbol">₲</div>
    <div><p className="eyebrow">APERTURA DE CAJA</p><h1>{gate ? 'Abrí la caja para comenzar' : 'Abrir nueva caja'}</h1><p className="muted">El saldo inicial se registra únicamente en {cashName}.</p></div>
    <label>Saldo inicial en {cashName.toUpperCase()}<MoneyInput autoFocus min={0} required value={amount} onValueChange={setAmount} /></label>
    <button className="primary" disabled={busy}>{busy ? 'Abriendo…' : 'Abrir caja'}</button>
  </form>;
  if (!gate) return <><PedidoErrorDialog message={error} onAccept={() => setError('')} /><section className="order-panel cash-open-panel">{form}</section></>;
  return <main className="cash-gate"><PedidoErrorDialog message={error} onAccept={() => setError('')} /><section className="cash-gate-card">{form}<div className="cash-gate-user"><span>{user?.nombre} · {user?.rol}</span><button type="button" className="secondary" onClick={onLogout}>Salir</button></div></section></main>;
}

function BoxStats({ box }) {
  return <div className="cash-stats"><div><span>Saldo inicial</span><strong>{formatMoney(box.monto_inicial)}</strong></div><div className="income"><span>Ingresos</span><strong>{formatMoney(box.total_ingresos)}</strong></div><div className="expense"><span>Egresos</span><strong>{formatMoney(box.total_egresos)}</strong></div><div><span>Saldo esperado</span><strong>{formatMoney(box.monto_esperado)}</strong></div></div>;
}

function BoxDetail({ boxId, onClose, onRequestClose }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  useEffect(() => { let current = true; setData(null); api(`/api/cajas/${boxId}?${new URLSearchParams({ page, pageSize: size })}`).then((value) => current && setData(value)).catch((e) => current && setError(e.message)); return () => { current = false; }; }, [boxId, page, size]);
  return <div className="modal-backdrop"><div className="modal cash-detail-modal" role="dialog" aria-modal="true" aria-label={`Detalle de caja ${boxId}`}><div className="modal-head"><div><p className="eyebrow">DETALLE DE CAJA</p><h2>Caja #{boxId}</h2></div><button className="modal-close" onClick={onClose}>×</button></div><PedidoErrorDialog message={error} onAccept={() => setError('')} />{!data ? <p>Cargando detalle…</p> : <><div className="cash-detail-meta"><span>Apertura: <strong>{dateTime(data.caja.fecha_apertura)}</strong></span><span>Abierta por: <strong>{data.caja.creado_por}</strong></span><span>Cierre: <strong>{dateTime(data.caja.fecha_cierre)}</strong></span><span>Cerrada por: <strong>{data.caja.cerrado_por || '—'}</strong></span></div><BoxStats box={data.caja} /><div className="cash-breakdown">{data.arqueos.map((row) => <article key={row.idcaja_arqueo}><strong>{row.forma_pago}</strong><span>Inicial: {formatMoney(row.monto_inicial)}</span><span>Ingresos: {formatMoney(row.total_ingresos)}</span><span>Egresos: {formatMoney(row.total_egresos)}</span><span>Esperado: {formatMoney(row.monto_esperado)}</span>{data.caja.estado === 'cerrada' && <><span>Contado: {formatMoney(row.monto_contado)}</span><span>Diferencia: {formatMoney(row.diferencia)}</span></>}</article>)}</div><h3>Movimientos</h3><div className="catalog-table-wrap"><table className="catalog-table cash-items"><thead><tr><th>Fecha y hora</th><th>Descripción</th><th>Tipo</th><th>Origen</th><th>Forma de pago</th><th>Estado</th><th className="numeric-cell">Monto</th></tr></thead><tbody>{!data.movimientos.length ? <tr><td colSpan="7" className="table-empty">La caja no tiene movimientos.</td></tr> : data.movimientos.map((item) => <tr key={item.idcaja_item} className={item.tipo_movimiento === 'ingreso' ? 'cash-income-row' : 'cash-expense-row'}><td>{dateTime(item.fecha_creado)}</td><td>{item.descripcion}</td><td><span className={`cash-type ${item.tipo_movimiento}`}>{item.tipo_movimiento.toUpperCase()}</span></td><td>{item.origen} #{item.origen_id}{item.es_reversion && <small>Reversión / devolución</small>}</td><td>{item.forma_pago}</td><td>{item.estado_origen || '—'}</td><td className="numeric-cell"><strong>{formatMoney(item.monto)}</strong></td></tr>)}</tbody></table></div><div className="catalog-footer"><label>Mostrar <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {data.page} de {data.totalPages}</span><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>{data.caja.estado === 'abierta' && <div className="modal-actions"><button className="primary danger" onClick={() => onRequestClose(data)}>Cerrar caja</button></div>}</>}</div></div>;
}

function CloseBox({ detail, onCancel, onDone }) {
  const feedback = useOperationFeedback(); const [cash, setCash] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const cashRow = detail.arqueos.find((row) => row.fk_idforma_pago === detail.efectivo.idforma_pago);
  const others = detail.arqueos.filter((row) => row.fk_idforma_pago !== detail.efectivo.idforma_pago);
  const boxId = detail.caja.idcaja_gral;
  const submit = async (event) => { event.preventDefault(); if (!window.confirm('¿Confirmás el cierre definitivo de esta caja?')) return; const feedbackId = feedback.begin('Cerrando caja…'); setBusy(true); try { await mutate(`/api/cajas/${boxId}/cerrar`, { conteos: { [detail.efectivo.idforma_pago]: cash } }); feedback.succeed(feedbackId, 'Caja cerrada correctamente.', { printUrl: `/api/cajas/${boxId}/ticket.pdf`, timeoutMs: 8000 }); onDone(); } catch (e) { setError(e.message); feedback.fail(feedbackId, e.message); } finally { setBusy(false); } };
  return <div className="modal-backdrop cash-close-layer"><div className="modal" role="dialog" aria-modal="true" aria-label="Cerrar caja"><div className="modal-head"><div><p className="eyebrow">ARQUEO FINAL</p><h2>Cerrar caja #{boxId}</h2></div><button className="modal-close" onClick={onCancel}>×</button></div><PedidoErrorDialog message={error} onAccept={() => setError('')} /><form className="modal-form" onSubmit={submit}>{detail.pendientes?.length > 0 && <div className="alert error"><strong>No se puede cerrar: hay pedidos pendientes de pago.</strong><ul className="cash-close-pending">{detail.pendientes.map((row) => <li key={row.idcuenta}>{row.mesa_numero ? `Mesa ${row.mesa_numero}` : row.tipo} · pedido {row.pedidos.map((n) => `#${n}`).join(', ')} · saldo {formatMoney(row.saldo)}</li>)}</ul>Cobralos o anulalos y volvé a intentar.</div>}<p>Ingresá solo el monto contado en {detail.efectivo.nombre.toLowerCase()}.{others.length > 0 && ' Las demás formas de pago se cierran por su monto esperado.'}</p><label>{detail.efectivo.nombre} · esperado {formatMoney(cashRow?.monto_esperado ?? 0)}<MoneyInput autoFocus min={0} required value={cash} onValueChange={setCash} /></label>{others.length > 0 && <ul className="cash-close-others">{others.map((row) => <li key={row.fk_idforma_pago}><span>{row.forma_pago}</span><strong>{formatMoney(row.monto_esperado)}</strong></li>)}</ul>}<div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary danger" disabled={busy || detail.pendientes?.length > 0}>{busy ? 'Cerrando…' : 'Confirmar cierre'}</button></div></form></div></div>;
}

export default function Caja() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(25); const [detailId, setDetailId] = useState(null); const [closing, setClosing] = useState(null);
  const [inicio, setInicio] = useState(''); const [fin, setFin] = useState('');
  const load = async () => { setError(''); try { setData(await api(`/api/cajas?${new URLSearchParams({ inicio, fin, page, pageSize: size })}`)); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, [inicio, fin, page, size]);
  const requestClose = (detail) => { setClosing(detail); setDetailId(null); };
  const closed = () => { setClosing(null); setPage(1); load(); };
  return <div className="catalog-page cash-page"><PedidoErrorDialog message={error} onAccept={() => setError('')} /><section className="cash-section"><TopbarSlot><label>Desde<input type="date" value={inicio} onChange={(e) => { setInicio(e.target.value); setPage(1); }} /></label><label>Hasta<input type="date" value={fin} onChange={(e) => { setFin(e.target.value); setPage(1); }} /></label><button className="secondary" onClick={load}>Actualizar</button></TopbarSlot><h3>Caja abierta</h3>{!data ? <p>Cargando cajas…</p> : data.abierta ? <article className="order-panel cash-open-card"><div className="cash-card-head"><div><span className="pill libre">ABIERTA</span><h2>Caja #{data.abierta.idcaja_gral}</h2><p>{dateTime(data.abierta.fecha_apertura)} · {data.abierta.creado_por}</p></div><div className="order-actions"><button className="secondary" onClick={() => setDetailId(data.abierta.idcaja_gral)}>Ver detalle</button><button className="primary danger" onClick={async () => { try { setClosing(await api(`/api/cajas/${data.abierta.idcaja_gral}`)); } catch (e) { setError(e.message); } }}>Cerrar caja</button></div></div><BoxStats box={data.abierta} /></article> : <CajaOpenForm onOpened={load} />}</section><section className="cash-section"><h3>Cajas cerradas</h3><div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Caja</th><th>Apertura</th><th>Cierre</th><th>Responsables</th><th className="numeric-cell">Esperado</th><th className="numeric-cell">Contado</th><th className="numeric-cell">Diferencia</th><th className="actions-col">Acciones</th></tr></thead><tbody>{!data ? <tr><td colSpan="8">Cargando…</td></tr> : !data.cerradas.length ? <tr><td colSpan="8" className="table-empty">{inicio || fin ? 'Sin cajas cerradas en ese rango de fechas.' : 'Todavía no hay cajas cerradas.'}</td></tr> : data.cerradas.map((box) => <tr key={box.idcaja_gral}><td><strong>#{box.idcaja_gral}</strong></td><td>{dateTime(box.fecha_apertura)}</td><td>{dateTime(box.fecha_cierre)}</td><td>{box.creado_por}<small>Cierre: {box.cerrado_por}</small></td><td className="numeric-cell">{formatMoney(box.monto_esperado)}</td><td className="numeric-cell">{formatMoney(box.monto_contado)}</td><td className="numeric-cell">{formatMoney(box.diferencia)}</td><td className="actions-col"><div className="order-list-actions"><button type="button" className="edit-button order-action-icon" onClick={() => setDetailId(box.idcaja_gral)} aria-label={`Ver detalle de la caja #${box.idcaja_gral}`} title="Ver detalle"><EyeIcon /></button><a className="edit-button ticket-link order-action-icon" href={`/api/cajas/${box.idcaja_gral}/ticket.pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Imprimir cierre de la caja #${box.idcaja_gral}`} title="Imprimir cierre"><PrinterIcon /></a></div></td></tr>)}</tbody></table></div>{data && <div className="catalog-footer"><label>Mostrar <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {data.page} de {data.totalPages}</span><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}</section>{detailId && <BoxDetail boxId={detailId} onClose={() => setDetailId(null)} onRequestClose={requestClose} />}{closing && <CloseBox detail={closing} onCancel={() => setClosing(null)} onDone={closed} />}</div>;
}
