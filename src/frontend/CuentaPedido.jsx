import { useEffect, useState } from 'react';
import { api, mutate, stateName } from './pedidos-api.js';
import { formatMoney as money } from './formatters.js';
import MoneyInput from './MoneyInput.jsx';
import FormaPagoBotones, { defaultFormId } from './FormaPagoBotones.jsx';
import PedidoErrorDialog from './PedidoErrorDialog.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';

export function CajaInicial({ onClose, onOpened }) {
 const feedback=useOperationFeedback();
 const [data,setData]=useState(null),[monto,setMonto]=useState('0'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{api('/api/cajas/estado').then(setData).catch(e=>setError(e.message));},[]);
 const submit=async e=>{e.preventDefault();const id=feedback.begin('Abriendo caja…');setBusy(true);setError('');try{const result=await mutate('/api/cajas/abrir',{monto_inicial:monto});onOpened?.();if(onClose)onClose();else setData(await api('/api/cajas/estado'));feedback.succeed(id,'Caja abierta correctamente.');}catch(e){feedback.fail(id,e.message);}finally{setBusy(false);}};
 return <div className={onClose?'modal-backdrop':'catalog-page'}><div className={onClose?'modal':'order-panel'} role={onClose?'dialog':undefined} aria-modal={onClose?true:undefined} aria-label="Apertura de caja"><div className="modal-head"><h2>Caja general</h2>{onClose&&<button className="modal-close" disabled={busy} onClick={onClose}>×</button>}</div><PedidoErrorDialog message={error} onAccept={()=>setError('')}/>{!data?<p>Cargando caja…</p>:data.caja?<p>Caja #{data.caja.idcaja_gral} abierta · {new Date(data.caja.fecha_apertura).toLocaleString('es-PY')}</p>:<form className="modal-form" onSubmit={submit}><p>Ingresá el saldo inicial únicamente en efectivo.</p><label>EFECTIVO<MoneyInput min={0} required className="numeric-cell" value={monto} onValueChange={setMonto}/></label><button className="primary" disabled={busy}>{busy?'Abriendo…':'Abrir caja'}</button></form>}</div></div>;
}

export default function CuentaPedido({ accountId, user, onClose, onOrder, onNew, onUpdated }) {
 const feedback = useOperationFeedback();
 const [data, setData] = useState(null);
 const [forms, setForms] = useState([]);
 const [payments, setPayments] = useState([]);
 const [busy, setBusy] = useState(false);
 const [finishingId, setFinishingId] = useState(null);
 const [error, setError] = useState('');
 const [box, setBox] = useState(false);
 const staff = user.permisos?.includes('FORM_PEDIDOS');

 const load = async () => {
  const [account, paymentForms] = await Promise.all([
   api(`/api/pedidos/cuentas/${accountId}`),
   api('/api/pedidos/formas-pago')
  ]);
  setData(account);
  setForms(paymentForms.items);
  setPayments([{
   fk_idforma_pago: defaultFormId(paymentForms.items),
   importe: account.saldo
  }]);
 };
 useEffect(() => { load().catch(e => setError(e.message)); }, [accountId]);

 const ready = data?.pedidos.every(p => ['listo', 'entregado', 'pagado', 'cancelado'].includes(p.estado));

 const finish = async (order) => {
  if (busy) return;
  const feedbackId = feedback.begin('Terminando pedido…');
  setBusy(true);
  setFinishingId(order.idpedido);
  setError('');
  let completed = false;
  try {
   const result = await mutate(`/api/pedidos/${order.idpedido}/terminar`, { version_web: order.version_web });
   completed = true;
   setData(current => current && ({
    ...current,
    pedidos: current.pedidos.map(item => item.idpedido === order.idpedido ? result.pedido : item)
   }));
   onUpdated?.();
   await load();
   feedback.succeed(feedbackId, result.pedido.estado === 'pagado' ? 'Pedido terminado y cuenta pagada.' : 'Pedido terminado. El saldo se cobra desde la cuenta.');
  } catch (e) {
   if (completed) {
    feedback.fail(feedbackId, 'El pedido se terminó, pero no se pudo actualizar la cuenta. Cerrá y volvé a abrirla.');
   } else {
    try { await load(); } catch (reloadError) { setError(reloadError.message); }
    feedback.fail(feedbackId, e.message);
   }
  } finally {
   setFinishingId(null);
   setBusy(false);
  }
 };

 const pay = async event => {
  event.preventDefault();
  if (busy) return;
  const feedbackId = feedback.begin('Registrando cobro…');
  setBusy(true);
  setError('');
  try {
   const result = await mutate(`/api/pedidos/cuentas/${accountId}/cobrar`, { pagos: data.saldo === 0 ? [] : payments });
   setData(result.cuenta);
   setPayments([{
    fk_idforma_pago: defaultFormId(forms),
    importe: result.cuenta.saldo
   }]);
   onUpdated?.();
   feedback.succeed(feedbackId, 'Cobro registrado correctamente.');
  } catch (e) {
   feedback.fail(feedbackId, e.message);
  } finally {
   setBusy(false);
  }
 };

 return <div className="modal-backdrop">
  <div className="modal account-modal" role="dialog" aria-modal="true" aria-label="Cuenta de pedidos">
   <div className="modal-head">
    <div><p className="eyebrow">CUENTA #{accountId}</p><h2>{data?.fk_idmesa ? 'Cuenta de mesa' : 'Cuenta del pedido'} · {data?.estado}</h2></div>
    <button className="modal-close" disabled={busy} onClick={onClose}>×</button>
   </div>
   <PedidoErrorDialog message={error} onAccept={() => setError('')} />
   {!data ? <p>Cargando cuenta…</p> : <div className={`account-body${data.estado === 'abierta' ? ' has-side' : ''}`}>
    <div className="account-main">
    <div className="catalog-table-wrap">
     <table className="catalog-table">
      <thead><tr><th>Pedido</th><th>Estado</th><th className="numeric-cell">Total</th><th /></tr></thead>
      <tbody>{data.pedidos.map(order => <tr key={order.idpedido}>
       <td>#{order.idpedido}</td>
       <td>{data.fk_idmesa && data.estado === 'abierta' && order.estado === 'en_preparacion'
        ? <button type="button" className="order-state-button" aria-label={`Terminar pedido #${order.idpedido}`} disabled={busy} onClick={() => finish(order)}>{finishingId === order.idpedido ? 'PROCESANDO…' : 'TERMINAR'}</button>
        : <span className={order.estado === 'listo' ? 'order-state-text is-finished' : 'order-state-text'}>{stateName(order.estado)}</span>}</td>
       <td className="numeric-cell">{money(order.monto_total)}</td>
       <td>{onOrder && <button className="edit-button" disabled={busy} onClick={() => onOrder(order.idpedido)}>Ver pedido</button>}</td>
      </tr>)}</tbody>
     </table>
    </div>
    <div className="order-totals account-totals">
     <span>Total cuenta <strong>{money(data.total)}</strong></span>
     <span>Cobrado neto <strong>{money(data.cobrado)}</strong></span>
     <span>Saldo <strong>{money(data.saldo)}</strong></span>
    </div>
    {data.pagos.length > 0 && <details open>
     <summary>Pagos y devoluciones</summary>
     {data.pagos.map(payment => <p key={payment.idpago}>Pago #{payment.idpago} · {payment.nombre} · {payment.estado} · {money(payment.importe)} · devuelto {money(Number(payment.importe) - Number(payment.disponible))}</p>)}
     {data.devoluciones.map(refund => <p key={refund.iddevolucion_pago}>Devolución #{refund.iddevolucion_pago} · pedido #{refund.fk_idpedido} · {money(refund.importe)} · {refund.motivo}</p>)}
    </details>}
    </div>
    {data.estado === 'abierta' && <div className="account-side">
     <div className="account-actions">
      {data.tipo === 'SALON' && onNew && <button className="secondary" disabled={busy} onClick={() => onNew(data)}>+ Nuevo pedido en esta mesa</button>}
      {data.tipo === 'SALON' && <a className="secondary ticket-link" href={`/api/mesas/cuentas/${accountId}/ticket.pdf`} target="_blank" rel="noopener noreferrer">Imprimir ticket</a>}
      {staff && <button className="secondary" disabled={busy} onClick={() => setBox(true)}>Ver / abrir caja</button>}
     </div>
     {!ready && <p className="form-hint">Primero terminá todos los pedidos para cobrar.</p>}
     {staff && <>
      <form className="modal-form" onSubmit={pay}>
       <h3>Cobrar cuenta</h3>
       {data.saldo > 0 && payments.map((payment, index) => <div className="payment-row" key={index}>
        <div className="payment-field"><span>Forma de pago</span><FormaPagoBotones forms={forms} disabled={busy} value={payment.fk_idforma_pago} onChange={value => setPayments(payments.map((item, itemIndex) => index === itemIndex ? { ...item, fk_idforma_pago: value } : item))} /></div>
        <label>Importe ₲<MoneyInput min={1} required disabled={busy} className="numeric-cell" value={payment.importe} onValueChange={value => setPayments(payments.map((item, itemIndex) => index === itemIndex ? { ...item, importe: value } : item))} /></label>
        <button type="button" className="edit-button" aria-label={`Quitar pago ${index + 1}`} disabled={busy || payments.length === 1} onClick={() => setPayments(payments.filter((_, itemIndex) => index !== itemIndex))}>×</button>
       </div>)}
       {data.saldo > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => setPayments([...payments, { fk_idforma_pago: '', importe: Math.max(0, data.saldo - payments.reduce((sum, payment) => sum + Number(payment.importe), 0)) }])}>+ Otra forma de pago</button>}
       <button className="primary" disabled={busy || !ready}>{busy ? 'Procesando…' : data.saldo === 0 ? 'Cerrar cuenta sin saldo' : 'Confirmar cobro'}</button>
      </form>
     </>}
    </div>}
   </div>}
   {box &&<CajaInicial onClose={() => setBox(false)} />}
  </div>
 </div>;
}

export function AnularPedido({ orderId, onClose, onDone }) {
 const feedback=useOperationFeedback();
 const [data,setData]=useState(null),[refunds,setRefunds]=useState({}),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{api(`/api/pedidos/${orderId}/anulacion`).then(setData).catch(e=>setError(e.message));},[orderId]);
 const submit=async e=>{e.preventDefault();const id=feedback.begin('Anulando pedido…');setBusy(true);setError('');try{await mutate(`/api/pedidos/${orderId}/anular`,{motivo:reason,devoluciones:Object.entries(refunds).filter(([,v])=>Number(v)>0).map(([key,value])=>({fk_idpago:Number(key),importe:value}))});feedback.succeed(id,'Pedido anulado correctamente.');onDone();}catch(e){feedback.fail(id,e.message);}finally{setBusy(false);}};
 return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Anular pedido"><div className="modal-head"><h2>Anular pedido #{orderId}</h2><button className="modal-close" disabled={busy} onClick={onClose}>×</button></div><PedidoErrorDialog message={error} onAccept={()=>setError('')}/>{data&&<form className="modal-form" onSubmit={submit}><p>Se anulará solamente este pedido. Los otros pedidos y pagos originales se conservarán.</p><label>Motivo de anulación<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label><p>Nuevo total de cuenta: <strong>{money(data.nuevo_total)}</strong></p><p>A devolver: <strong>{money(data.devolver)}</strong></p>{data.devolver>0&&<><p>Distribuí la devolución entre los pagos originales. Necesitás una caja abierta.</p>{data.cuenta.pagos.filter(p=>p.estado==='aprobado'&&Number(p.disponible)>0).map(p=><label key={p.idpago}>Pago #{p.idpago} · {p.nombre} · disponible {money(p.disponible)}<MoneyInput min={0} max={p.disponible} value={refunds[p.idpago]??''} onValueChange={value=>setRefunds({...refunds,[p.idpago]:value})}/></label>)}<p>Distribuido: {money(Object.values(refunds).reduce((s,v)=>s+Number(v),0))}</p></>}<button className="primary danger" disabled={busy||Object.values(refunds).reduce((s,v)=>s+Number(v),0)!==data.devolver}>{busy?'Anulando…':'Confirmar anulación'}</button></form>}</div></div>;
}
