import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { api, mutate } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import MoneyInput from './MoneyInput.jsx';
import PedidoErrorDialog from './PedidoErrorDialog.jsx';
import { EyeIcon, PdfIcon, PrinterIcon } from './ActionIcons.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';
import './caja.css';
import TicketLink from './TicketLink.jsx';
import { urlConTerminal } from './terminal.js';

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

// Pedidos de cada usuario (el que creó el pedido): cobrado en esta caja por forma de pago y lo pendiente.
function CashByUser({ data }) {
  if (!data) return null;
  const pedidos = n => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`;
  return <div className="cash-by-user"><h4>Por usuario</h4>{!data.filas.length ? <p className="cash-by-user-empty">Todavía no hay pedidos en esta caja.</p> : <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Usuario</th><th className="numeric-cell">Pedidos</th>{data.formas.map(f => <th key={f} className="numeric-cell">{f}</th>)}<th className="numeric-cell">Total cobrado</th><th className="numeric-cell">Pendiente</th></tr></thead><tbody>{data.filas.map(r => <tr key={r.usuario}><td><strong>{r.nombre}</strong></td><td className="numeric-cell">{r.pedidos}</td>{data.formas.map(f => <td key={f} className="numeric-cell">{r.formas[f] ? formatMoney(r.formas[f]) : '—'}</td>)}<td className="numeric-cell"><strong>{formatMoney(r.total_cobrado)}</strong></td><td className="numeric-cell">{r.pendiente ? <>{formatMoney(r.pendiente)}<small>{pedidos(r.pedidos_pendientes)}</small></> : '—'}</td></tr>)}</tbody><tfoot><tr><td><strong>Total</strong></td><td className="numeric-cell"><strong>{data.totales.pedidos}</strong></td>{data.formas.map(f => <td key={f} className="numeric-cell"><strong>{formatMoney(data.totales.formas[f] || 0)}</strong></td>)}<td className="numeric-cell"><strong>{formatMoney(data.totales.total_cobrado)}</strong></td><td className="numeric-cell"><strong>{formatMoney(data.totales.pendiente)}</strong>{data.totales.pedidos_pendientes > 0 && <small>{pedidos(data.totales.pedidos_pendientes)}</small>}</td></tr></tfoot></table></div>}<small className="cash-by-user-note">Solo cobros de pedidos. Un cobro de mesa completa se reparte entre sus pedidos según su total.</small></div>;
}

function BoxStats({ box }) {
  const pedidos = Number(box.cantidad_pedidos || 0);
  return <div className="cash-stats-group"><div className="cash-stats"><div><span>Saldo inicial</span><strong>{formatMoney(box.monto_inicial)}</strong></div><div className="income"><span>Ingresos</span><strong>{formatMoney(box.total_ingresos)}</strong></div><div className="expense"><span>Egresos</span><strong>{formatMoney(box.total_egresos)}</strong></div><div><span>Saldo esperado</span><strong>{formatMoney(box.monto_esperado)}</strong></div></div>
    {/* Pedidos no anulados creados mientras la caja estuvo abierta. */}
    <div className="cash-stats cash-stats-orders"><div className="orders"><span>Total pedidos sin delivery</span><strong>{formatMoney(box.total_pedidos_sin_delivery)}</strong><small>{pedidos} {pedidos === 1 ? 'pedido' : 'pedidos'}</small></div><div className="delivery"><span>Total delivery</span><strong>{formatMoney(box.total_delivery)}</strong></div></div></div>;
}

// Arqueo guardado de una caja cerrada: billetes, POS y la diferencia.
function ClosedCount({ caja, arqueo }) {
  const n = (value) => Number(value || 0);
  const diferencia = n(caja.cierre_diferencia);
  return <div className="cash-closed-count"><div><h4>Billetes</h4><ul className="cash-count-summary">{arqueo.billetes.map(b => <li key={b.denominacion} className="sub"><span>{b.cantidad} × {formatMoney(b.denominacion)}</span><span>{formatMoney(b.cantidad * b.denominacion)}</span></li>)}{n(caja.cierre_monedas) > 0 && <li className="sub"><span>Monedas / otros</span><span>{formatMoney(caja.cierre_monedas)}</span></li>}<li className="total"><span>Total contado</span><strong>{formatMoney(n(caja.cierre_billetes) + n(caja.cierre_monedas))}</strong></li></ul></div>
    <div><h4>POS</h4><ul className="cash-count-summary">{arqueo.maquinas_pos.filter(m => m.contado !== null).map(m => <li key={m.idmaquina_pos} className="sub"><span>{m.nombre}</span><span>{formatMoney(m.contado)}</span></li>)}<li className="total"><span>Total POS</span><strong>{formatMoney(caja.cierre_pos)}</strong></li></ul></div>
    <div><h4>Arqueo</h4><ul className="cash-count-summary"><li><span>Billetes y monedas</span><strong>{formatMoney(n(caja.cierre_billetes) + n(caja.cierre_monedas))}</strong></li><li><span>− Saldo inicial</span><strong>{formatMoney(caja.monto_inicial)}</strong></li><li><span>+ Egresos</span><strong>{formatMoney(caja.cierre_egresos)}</strong></li><li><span>+ POS</span><strong>{formatMoney(caja.cierre_pos)}</strong></li><li className="total"><span>Ingresado</span><strong>{formatMoney(n(caja.cierre_vendido) + diferencia)}</strong></li><li><span>Vendido (delivery {formatMoney(caja.cierre_delivery)})</span><strong>{formatMoney(caja.cierre_vendido)}</strong></li><li className={`diff ${diffClass(diferencia)}`}><span>Diferencia</span><strong>{diferencia === 0 ? 'Cuadra' : signedMoney(diferencia)}</strong></li></ul></div></div>;
}

function BoxDetail({ boxId, onClose, onRequestClose }) {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  useEffect(() => { let current = true; setData(null); api(`/api/cajas/${boxId}?${new URLSearchParams({ page, pageSize: size })}`).then((value) => current && setData(value)).catch((e) => current && setError(e.message)); return () => { current = false; }; }, [boxId, page, size]);
  return <div className="modal-backdrop"><div className="modal cash-detail-modal" role="dialog" aria-modal="true" aria-label={`Detalle de caja ${boxId}`}><div className="modal-head"><div><p className="eyebrow">DETALLE DE CAJA</p><h2>Caja #{boxId}</h2></div><button className="modal-close" onClick={onClose}>×</button></div><PedidoErrorDialog message={error} onAccept={() => setError('')} />{!data ? <p>Cargando detalle…</p> : <><div className="cash-detail-meta"><span>Apertura: <strong>{dateTime(data.caja.fecha_apertura)}</strong></span><span>Abierta por: <strong>{data.caja.creado_por}</strong></span><span>Cierre: <strong>{dateTime(data.caja.fecha_cierre)}</strong></span><span>Cerrada por: <strong>{data.caja.cerrado_por || '—'}</strong></span></div><BoxStats box={data.caja} />{data.caja.cierre_diferencia !== null && data.caja.cierre_diferencia !== undefined && <ClosedCount caja={data.caja} arqueo={data.arqueo} />}<div className="cash-breakdown">{data.arqueos.map((row) => <article key={row.idcaja_arqueo}><strong>{row.forma_pago}</strong><span>Inicial: {formatMoney(row.monto_inicial)}</span><span>Ingresos: {formatMoney(row.total_ingresos)}</span><span>Egresos: {formatMoney(row.total_egresos)}</span><span>Esperado: {formatMoney(row.monto_esperado)}</span>{data.caja.estado === 'cerrada' && <><span>Contado: {formatMoney(row.monto_contado)}</span><span>Diferencia: {formatMoney(row.diferencia)}</span></>}</article>)}</div><h3>Movimientos</h3><div className="catalog-table-wrap"><table className="catalog-table cash-items"><thead><tr><th>Fecha y hora</th><th>Descripción</th><th>Tipo</th><th>Origen</th><th>Forma de pago</th><th>Estado</th><th className="numeric-cell">Monto</th></tr></thead><tbody>{!data.movimientos.length ? <tr><td colSpan="7" className="table-empty">La caja no tiene movimientos.</td></tr> : data.movimientos.map((item) => <tr key={item.idcaja_item} className={item.tipo_movimiento === 'ingreso' ? 'cash-income-row' : 'cash-expense-row'}><td>{dateTime(item.fecha_creado)}</td><td>{item.descripcion}</td><td><span className={`cash-type ${item.tipo_movimiento}`}>{item.tipo_movimiento.toUpperCase()}</span></td><td>{item.origen} #{item.origen_id}{item.es_reversion && <small>Reversión / devolución</small>}</td><td>{item.forma_pago}</td><td>{item.estado_origen || '—'}</td><td className="numeric-cell"><strong>{formatMoney(item.monto)}</strong></td></tr>)}</tbody></table></div><div className="catalog-footer"><label>Mostrar <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {data.page} de {data.totalPages}</span><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>{data.caja.estado === 'abierta' && <div className="modal-actions"><button className="primary danger" onClick={() => onRequestClose(data)}>Cerrar caja</button></div>}</>}</div></div>;
}

// Diferencia con signo: + sobra, − falta.
const signedMoney = (value) => value === 0 ? formatMoney(0) : `${value > 0 ? '+' : '−'} ${formatMoney(Math.abs(value))}`;
const diffClass = (value) => value === 0 ? 'ok' : value > 0 ? 'over' : 'short';

// Arqueo del cierre: se cuentan los billetes y el resumen de cada POS y se compara con lo vendido.
// Diferencia = (billetes + monedas − saldo inicial + egresos en efectivo) + POS − vendido con delivery.
function CloseBox({ detail, onCancel, onDone }) {
  const feedback = useOperationFeedback(); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const a = detail.arqueo; const boxId = detail.caja.idcaja_gral;
  const [billetes, setBilletes] = useState(() => Object.fromEntries(a.denominaciones.map(d => [d, ''])));
  const [monedas, setMonedas] = useState('');
  const [pos, setPos] = useState(() => Object.fromEntries(a.maquinas_pos.map(m => [m.idmaquina_pos, m.rendido ? String(m.rendido) : ''])));
  const totalBilletes = a.denominaciones.reduce((sum, d) => sum + d * Number(billetes[d] || 0), 0);
  const totalPos = a.maquinas_pos.reduce((sum, m) => sum + Number(pos[m.idmaquina_pos] || 0), 0);
  const ingresado = totalBilletes + Number(monedas || 0) - a.saldo_inicial + a.total_egresos + totalPos;
  const diferencia = ingresado - a.vendido;
  // Enter pasa al campo siguiente en lugar de cerrar la caja.
  const nextOnEnter = (event) => {
    if (event.key !== 'Enter' || event.target.tagName !== 'INPUT') return;
    event.preventDefault();
    const inputs = [...event.currentTarget.querySelectorAll('input:not([disabled])')];
    inputs[inputs.indexOf(event.target) + 1]?.focus();
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!(await feedback.confirm({ tone: 'danger', title: '¿Cerrar la caja?', message: `El cierre es definitivo. Diferencia del arqueo: ${signedMoney(diferencia)}.`, detail: 'Después del cierre esta caja ya no recibe movimientos. Revisá la cantidad de billetes y los montos de cada POS antes de confirmar.', cancelLabel: 'Volver al conteo', confirmLabel: 'Cerrar caja' }))) return;
    const feedbackId = feedback.begin('Cerrando caja…'); setBusy(true);
    try {
      await mutate(`/api/cajas/${boxId}/cerrar`, { billetes, monedas, pos });
      feedback.succeed(feedbackId, 'Caja cerrada correctamente.', { printUrl: `/api/cajas/${boxId}/ticket.pdf`, timeoutMs: 8000 }); onDone();
    } catch (e) { setError(e.message); feedback.fail(feedbackId, e.message); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop cash-close-layer"><div className="modal cash-close-modal" role="dialog" aria-modal="true" aria-label="Cerrar caja"><div className="modal-head"><div><p className="eyebrow">ARQUEO FINAL</p><h2>Cerrar caja #{boxId}</h2></div><button className="modal-close" onClick={onCancel}>×</button></div><PedidoErrorDialog message={error} onAccept={() => setError('')} />
    <form className="modal-form" onSubmit={submit} onKeyDown={nextOnEnter}>
      {detail.pendientes?.length > 0 && <div className="alert error"><strong>No se puede cerrar: hay pedidos pendientes de pago.</strong><ul className="cash-close-pending">{detail.pendientes.map((row) => <li key={row.idcuenta}>{row.mesa_numero ? `Mesa ${row.mesa_numero}` : row.tipo} · pedido {row.pedidos.map((n) => `#${n}`).join(', ')} · saldo {formatMoney(row.saldo)}</li>)}</ul>Cobralos o anulalos y volvé a intentar.</div>}
      {detail.delivery_pendiente?.total > 0 && <div className="alert cash-delivery-notice" role="status"><strong>Delivery por pagar a entregadores: {formatMoney(detail.delivery_pendiente.total)}</strong> ({detail.delivery_pendiente.pedidos} pedidos cobrados). Esa plata está en caja pero no es del local; pagala desde Caja y finanzas → Pagos a delivery.</div>}
      <div className="cash-count">
        <section className="cash-count-bills"><h4>Billetes</h4>
          <table><thead><tr><th>Billete</th><th>Cantidad</th><th className="numeric-cell">Subtotal</th></tr></thead><tbody>
            {a.denominaciones.map((d, index) => <tr key={d}><td><strong>{formatMoney(d)}</strong></td><td><MoneyInput autoFocus={index === 0} min={0} value={billetes[d]} onValueChange={(value) => setBilletes(prev => ({ ...prev, [d]: value }))} aria-label={`Cantidad de billetes de ${formatMoney(d)}`} disabled={busy} /></td><td className="numeric-cell">{formatMoney(d * Number(billetes[d] || 0))}</td></tr>)}
            <tr><td><strong>Monedas / otros</strong></td><td><MoneyInput min={0} value={monedas} onValueChange={setMonedas} aria-label="Monto en monedas u otros" disabled={busy} /></td><td className="numeric-cell">{formatMoney(Number(monedas || 0))}</td></tr>
          </tbody><tfoot><tr><td colSpan="2">Total contado</td><td className="numeric-cell">{formatMoney(totalBilletes + Number(monedas || 0))}</td></tr></tfoot></table>
        </section>
        <section className="cash-count-side">
          <h4>POS (monto del resumen)</h4>
          {!a.maquinas_pos.length ? <p className="muted">No hay máquinas POS activas.</p> : <div className="cash-count-pos">{a.maquinas_pos.map(m => <label key={m.idmaquina_pos}><span>{m.nombre}{m.rendido > 0 && <small>Rendido por delivery: {formatMoney(m.rendido)}</small>}</span><MoneyInput min={0} value={pos[m.idmaquina_pos]} onValueChange={(value) => setPos(prev => ({ ...prev, [m.idmaquina_pos]: value }))} aria-label={`Monto del POS ${m.nombre}`} disabled={busy} /></label>)}</div>}
          <h4>Resumen</h4>
          <ul className="cash-count-summary">
            <li><span>Billetes y monedas</span><strong>{formatMoney(totalBilletes + Number(monedas || 0))}</strong></li>
            <li><span>− Saldo inicial</span><strong>{formatMoney(a.saldo_inicial)}</strong></li>
            <li><span>+ Egresos en {a.efectivo.nombre.toLowerCase()}</span><strong>{formatMoney(a.total_egresos)}</strong></li>
            {a.egresos.map(e => <li key={e.origen} className="sub"><span>{e.etiqueta}{e.cantidad ? ` (${e.cantidad})` : ''}</span><span>{formatMoney(e.monto)}</span></li>)}
            <li><span>+ POS</span><strong>{formatMoney(totalPos)}</strong></li>
            <li className="total"><span>Ingresado</span><strong>{formatMoney(ingresado)}</strong></li>
            <li><span>Vendido sin delivery</span><strong>{formatMoney(a.vendido_sin_delivery)}</strong></li>
            <li><span>+ Delivery</span><strong>{formatMoney(a.delivery)}</strong></li>
            <li className="total"><span>Vendido</span><strong>{formatMoney(a.vendido)}</strong></li>
            <li className={`diff ${diffClass(diferencia)}`}><span>Diferencia</span><strong>{diferencia === 0 ? 'Cuadra' : signedMoney(diferencia)}</strong></li>
          </ul>
        </section>
      </div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={onCancel}>Cancelar</button><button className="primary danger" disabled={busy || detail.pendientes?.length > 0}>{busy ? 'Cerrando…' : 'Confirmar cierre'}</button></div>
    </form></div></div>;
}

export default function Caja() {
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [page, setPage] = useState(1); const [size, setSize] = useState(25); const [detailId, setDetailId] = useState(null); const [closing, setClosing] = useState(null);
  const [inicio, setInicio] = useState(''); const [fin, setFin] = useState('');
  const load = async () => { setError(''); try { setData(await api(`/api/cajas?${new URLSearchParams({ inicio, fin, page, pageSize: size })}`)); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, [inicio, fin, page, size]);
  const requestClose = (detail) => { setClosing(detail); setDetailId(null); };
  const closed = () => { setClosing(null); setPage(1); load(); };
  return <div className="catalog-page cash-page"><PedidoErrorDialog message={error} onAccept={() => setError('')} /><section className="cash-section"><TopbarSlot><label>Desde<input type="date" value={inicio} onChange={(e) => { setInicio(e.target.value); setPage(1); }} /></label><label>Hasta<input type="date" value={fin} onChange={(e) => { setFin(e.target.value); setPage(1); }} /></label><button className="secondary" onClick={load}>Actualizar</button></TopbarSlot><h3>Caja abierta</h3>{!data ? <p>Cargando cajas…</p> : data.abierta ? <article className="order-panel cash-open-card"><div className="cash-card-head"><div><span className="pill libre">ABIERTA</span><h2>Caja #{data.abierta.idcaja_gral}</h2><p>{dateTime(data.abierta.fecha_apertura)} · {data.abierta.creado_por}</p></div><div className="order-actions"><button className="secondary" onClick={() => setDetailId(data.abierta.idcaja_gral)}>Ver detalle</button><button className="primary danger" onClick={async () => { try { setClosing(await api(`/api/cajas/${data.abierta.idcaja_gral}`)); } catch (e) { setError(e.message); } }}>Cerrar caja</button></div></div><BoxStats box={data.abierta} />{data.delivery_pendiente?.total > 0 && <div className="alert cash-delivery-notice" role="status"><strong>Delivery por pagar a entregadores: {formatMoney(data.delivery_pendiente.total)}</strong> ({data.delivery_pendiente.pedidos} pedidos cobrados). Esa plata está en caja pero no es del local; pagala desde Caja y finanzas → Pagos a delivery.</div>}<CashByUser data={data.por_usuario} /></article> : <CajaOpenForm onOpened={load} />}</section><section className="cash-section"><h3>Cajas cerradas</h3><div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Caja</th><th>Apertura</th><th>Cierre</th><th>Responsables</th><th className="numeric-cell">Vendido / esperado</th><th className="numeric-cell">Ingresado / contado</th><th className="numeric-cell">Diferencia</th><th className="actions-col">Acciones</th></tr></thead><tbody>{!data ? <tr><td colSpan="8">Cargando…</td></tr> : !data.cerradas.length ? <tr><td colSpan="8" className="table-empty">{inicio || fin ? 'Sin cajas cerradas en ese rango de fechas.' : 'Todavía no hay cajas cerradas.'}</td></tr> : data.cerradas.map((box) => <tr key={box.idcaja_gral}><td><strong>#{box.idcaja_gral}</strong></td><td>{dateTime(box.fecha_apertura)}</td><td>{dateTime(box.fecha_cierre)}</td><td>{box.creado_por}<small>Cierre: {box.cerrado_por}</small></td>{box.cierre_diferencia !== null && box.cierre_diferencia !== undefined ? <><td className="numeric-cell">{formatMoney(box.cierre_vendido)}<small>Vendido</small></td><td className="numeric-cell">{formatMoney(Number(box.cierre_vendido) + Number(box.cierre_diferencia))}<small>Billetes + egresos + POS</small></td><td className={`numeric-cell cash-diff ${diffClass(Number(box.cierre_diferencia))}`}><strong>{Number(box.cierre_diferencia) === 0 ? 'Cuadra' : signedMoney(Number(box.cierre_diferencia))}</strong></td></> : <><td className="numeric-cell">{formatMoney(box.monto_esperado)}</td><td className="numeric-cell">{formatMoney(box.monto_contado)}</td><td className="numeric-cell">{formatMoney(box.diferencia)}</td></>}<td className="actions-col"><div className="order-list-actions"><button type="button" className="edit-button order-action-icon" onClick={() => setDetailId(box.idcaja_gral)} aria-label={`Ver detalle de la caja #${box.idcaja_gral}`} title="Ver detalle"><EyeIcon /></button><TicketLink className="edit-button ticket-link order-action-icon" href={`/api/cajas/${box.idcaja_gral}/ticket.pdf`} aria-label={`Imprimir cierre de la caja #${box.idcaja_gral}`} title="Imprimir cierre"><PrinterIcon /></TicketLink><a className="edit-button ticket-link order-action-icon" href={urlConTerminal(`/api/cajas/${box.idcaja_gral}/ticket.pdf`)} target="_blank" rel="noopener noreferrer" aria-label={`Vista previa del cierre de la caja #${box.idcaja_gral}`} title="Vista previa (PDF)"><PdfIcon /></a></div></td></tr>)}</tbody></table></div>{data && <div className="catalog-footer"><label>Mostrar <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label><span>Página {data.page} de {data.totalPages}</span><button className="page-button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>}</section>{detailId && <BoxDetail boxId={detailId} onClose={() => setDetailId(null)} onRequestClose={requestClose} />}{closing && <CloseBox detail={closing} onCancel={() => setClosing(null)} onDone={closed} />}</div>;
}
