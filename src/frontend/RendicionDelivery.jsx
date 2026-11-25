import { useEffect, useMemo, useState } from 'react';
import { api, mutate, stateName } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import FormaPagoBotones from './FormaPagoBotones.jsx';
import MoneyInput from './MoneyInput.jsx';
import { useOperationFeedback } from './OperationFeedback.jsx';

// Rendición del entregador al final del turno: por cada pedido que llevó se elige cómo pagó el cliente
// (efectivo, o tarjeta/QR en el POS del entregador) y se le paga su delivery en efectivo.
// Neto = efectivo cobrado − delivery: lo entrega el entregador, o se lo paga el local si da negativo.
export const rendicionTicketUrl = id => `/api/pagos-delivery/rendiciones/${id}/ticket.pdf`;
// Propone la forma que indicó el entregador en su panel; si no indicó ninguna, efectivo.
const pagosDe = (pedido, efectivo) => pedido.saldo > 0 ? [{ fk_idforma_pago: String(pedido.fk_idforma_pago_entrega || efectivo || ''), importe: String(pedido.saldo) }] : [];

export default function RendicionDelivery({ courierId, onClose, onDone }) {
  const feedback = useOperationFeedback();
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  // Por pedido: si se incluye y cómo pagó el cliente (una o dos formas).
  const [rows, setRows] = useState({});
  // Cierre del POS: máquina que usó el entregador y monto de su resumen impreso.
  const [maquinaPos, setMaquinaPos] = useState(''), [posInformado, setPosInformado] = useState('');

  useEffect(() => {
    let current = true;
    api(`/api/pagos-delivery/rendicion/${courierId}`).then(d => {
      if (!current) return;
      setData(d);
      if (d.maquinas_pos?.length === 1) setMaquinaPos(String(d.maquinas_pos[0].idmaquina_pos));
      setRows(Object.fromEntries(d.pedidos.map(p => [p.idpedido, { incluir: true, pagos: pagosDe(p, d.fk_idforma_efectivo) }])));
    }).catch(e => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [courierId]);

  const efectivo = String(data?.fk_idforma_efectivo || '');
  const elegidos = (data?.pedidos || []).filter(p => rows[p.idpedido]?.incluir);
  const resumen = useMemo(() => {
    const conPos = new Set((data?.formas || []).filter(f => f.usa_pos).map(f => String(f.idforma_pago)));
    let cash = 0, otros = 0, delivery = 0, faltan = 0, pos = 0;
    for (const p of elegidos) {
      const pagos = rows[p.idpedido].pagos;
      const cobrado = pagos.reduce((sum, pay) => sum + Number(pay.importe || 0), 0);
      if (cobrado !== p.saldo || pagos.some(pay => Number(pay.importe) > 0 && !pay.fk_idforma_pago)) faltan += 1;
      for (const pay of pagos) {
        if (pay.fk_idforma_pago === efectivo) cash += Number(pay.importe || 0); else otros += Number(pay.importe || 0);
        if (conPos.has(pay.fk_idforma_pago)) pos += Number(pay.importe || 0);
      }
      delivery += p.delivery_a_pagar;
    }
    return { cash, otros, delivery, neto: cash - delivery, faltan, pos };
  }, [rows, data]);
  const posCargado = posInformado !== '';
  const posDiferencia = Number(posInformado || 0) - resumen.pos;
  const faltaPos = resumen.pos > 0 && (!maquinaPos || !posCargado);

  const setRow = (pedidoId, values) => setRows(current => ({ ...current, [pedidoId]: { ...current[pedidoId], ...values } }));
  const setPago = (pedido, index, values) => setRow(pedido.idpedido, { pagos: rows[pedido.idpedido].pagos.map((pay, i) => i === index ? { ...pay, ...values } : pay) });
  // Dividir: la segunda forma arranca vacía; el importe de la primera se ajusta solo para cubrir el saldo.
  const split = pedido => setRow(pedido.idpedido, { pagos: [{ ...rows[pedido.idpedido].pagos[0], importe: String(pedido.saldo) }, { fk_idforma_pago: '', importe: '0' }] });
  const unsplit = pedido => setRow(pedido.idpedido, { pagos: [{ ...rows[pedido.idpedido].pagos[0], importe: String(pedido.saldo) }] });
  const secondAmount = (pedido, value) => {
    const second = Math.min(pedido.saldo, Number(value || 0));
    const [first, other] = rows[pedido.idpedido].pagos;
    setRow(pedido.idpedido, { pagos: [{ ...first, importe: String(pedido.saldo - second) }, { ...other, importe: String(second) }] });
  };

  const confirm = async event => {
    event.preventDefault();
    if (busy || !elegidos.length || resumen.faltan || faltaPos) return;
    const feedbackId = feedback.begin('Registrando la rendición…');
    setBusy(true); setError('');
    try {
      const { rendicion } = await mutate('/api/pagos-delivery/rendir', {
        fk_identregador_delivery: data.entregador.id, neto: resumen.neto,
        ...(resumen.pos > 0 ? { fk_idmaquina_pos: maquinaPos, pos_informado: posInformado } : {}),
        pedidos: elegidos.map(p => ({ idpedido: p.idpedido, pagos: rows[p.idpedido].pagos.filter(pay => Number(pay.importe) > 0) }))
      });
      const texto = rendicion.neto >= 0 ? `${rendicion.entregador} entrega ${formatMoney(rendicion.neto)}` : `Se le pagan ${formatMoney(-rendicion.neto)} a ${rendicion.entregador}`;
      feedback.succeed(feedbackId, `Rendición #${rendicion.idrendicion_delivery}: ${texto} (${rendicion.pedidos.length} pedidos). ¿Imprimir el comprobante para que firme?`,
        { printUrl: rendicionTicketUrl(rendicion.idrendicion_delivery), timeoutMs: 12000 });
      onDone?.(rendicion);
    } catch (e) { setError(e.message); feedback.fail(feedbackId, e.message); } finally { setBusy(false); }
  };

  const allChecked = elegidos.length === (data?.pedidos.length || 0);
  return <div className="modal-backdrop"><div className="modal rendicion-modal" role="dialog" aria-modal="true" aria-label="Rendición del entregador">
    <div className="modal-head"><div><p className="eyebrow">RENDICIÓN DEL TURNO</p><h2>{data ? data.entregador.nombre : 'Cargando…'}</h2></div><button className="modal-close" disabled={busy} onClick={onClose} aria-label="Cerrar">×</button></div>
    {!data ? <p className="muted">{error || 'Cargando pedidos…'}</p> : !data.pedidos.length ? <p className="muted">No tiene pedidos pendientes de rendir.</p> : <form className="modal-form rendicion-form" onSubmit={confirm}>
      {!data.caja_abierta && <div className="alert delivery-warning">No hay una caja abierta: abrila en Caja general para poder rendir.</div>}
      {!efectivo && <div className="alert error">Falta la forma de pago "Efectivo".</div>}
      <label className="check-label rendicion-all"><input type="checkbox" checked={allChecked} onChange={e => setRows(current => Object.fromEntries(Object.entries(current).map(([k, v]) => [k, { ...v, incluir: e.target.checked }])))} />Rendir todos ({data.pedidos.length})</label>
      <div className="rendicion-list">{data.pedidos.map(p => {
        const row = rows[p.idpedido];
        if (!row) return null;
        const [first, second] = row.pagos;
        return <article key={p.idpedido} className={`rendicion-item${row.incluir ? '' : ' is-off'}`}>
          <label className="check-label rendicion-item-head"><input type="checkbox" checked={row.incluir} onChange={e => setRow(p.idpedido, { incluir: e.target.checked })} />
            <span><strong>#{p.idpedido} · {p.cliente}</strong><small>{p.fecha.slice(8, 10)}/{p.fecha.slice(5, 7)} {p.fecha.slice(11)} · {p.zona_nombre || 'Sin zona'}{p.estado === 'en_preparacion' ? ` · ${stateName(p.estado)} (se termina al rendir)` : ''}</small></span></label>
          <div className="rendicion-amounts">
            <span>Total <strong>{formatMoney(p.total)}</strong></span>
            {p.cobrado_antes > 0 && <span>Pagado antes <strong>{formatMoney(p.cobrado_antes)}</strong></span>}
            <span>Delivery <strong>{p.delivery_a_pagar ? formatMoney(p.delivery_a_pagar) : 'ya pagado'}</strong></span>
          </div>
          {row.incluir && (p.saldo === 0 ? <p className="form-hint">Ya estaba cobrado: solo se le paga el delivery.</p> : <div className="rendicion-pay">
            <span className="field-label">Cobró {formatMoney(p.saldo)} con</span>
            <FormaPagoBotones forms={data.formas} disabled={busy} value={first.fk_idforma_pago} onChange={value => setPago(p, 0, { fk_idforma_pago: value })} />
            {second ? <div className="rendicion-split">
              <span>{formatMoney(Number(first.importe))} con la primera y</span>
              <MoneyInput min={0} max={p.saldo} value={second.importe} disabled={busy} onValueChange={value => secondAmount(p, value)} aria-label="Importe con la segunda forma" />
              <span>con</span>
              <FormaPagoBotones forms={data.formas.filter(f => String(f.idforma_pago) !== first.fk_idforma_pago)} disabled={busy} value={second.fk_idforma_pago} onChange={value => setPago(p, 1, { fk_idforma_pago: value })} />
              <button type="button" className="secondary" disabled={busy} onClick={() => unsplit(p)}>Una sola forma</button>
            </div> : <button type="button" className="secondary rendicion-split-button" disabled={busy} onClick={() => split(p)}>Pagó con dos formas</button>}
          </div>)}
        </article>;
      })}</div>
      {resumen.pos > 0 && <section className="rendicion-pos" aria-label="Cierre del POS">
        <h3>Cierre del POS</h3>
        {!data.maquinas_pos?.length ? <div className="alert error">No hay máquinas POS activas: cargalas en Caja y finanzas · Máquinas POS.</div> : <>
          <span className="field-label">Máquina</span>
          <FormaPagoBotones forms={data.maquinas_pos.map(m => ({ idforma_pago: m.idmaquina_pos, nombre: m.nombre }))} disabled={busy} value={maquinaPos} onChange={setMaquinaPos} />
          <div className="rendicion-pos-amounts">
            <label>Monto del resumen del POS<MoneyInput min={0} value={posInformado} disabled={busy} onValueChange={value => setPosInformado(value === '' || value === null || value === undefined ? '' : String(value))} aria-label="Monto del resumen del POS" /></label>
            <span>Según el sistema <strong>{formatMoney(resumen.pos)}</strong></span>
            <span className={`rendicion-pos-diff${!posCargado ? '' : posDiferencia === 0 ? ' is-ok' : ' is-bad'}`}>Diferencia <strong>{!posCargado ? '—' : posDiferencia === 0 ? 'Coincide' : `${posDiferencia > 0 ? 'Sobra' : 'Falta'} ${formatMoney(Math.abs(posDiferencia))}`}</strong></span>
          </div>
          {posCargado && posDiferencia !== 0 && <p className="form-hint danger">El resumen del POS no coincide con lo cobrado en el sistema. Se puede rendir igual: la diferencia queda registrada.</p>}
        </>}
      </section>}
      <div className="rendicion-summary">
        <span>Efectivo cobrado <strong>{formatMoney(resumen.cash)}</strong></span>
        <span>Tarjeta / QR / otros <strong>{formatMoney(resumen.otros)}</strong></span>
        <span>Delivery del entregador <strong>− {formatMoney(resumen.delivery)}</strong></span>
        <span className={`rendicion-neto${resumen.neto < 0 ? ' is-pay' : ''}`}>{resumen.neto >= 0 ? 'El entregador entrega' : 'El local le paga'} <strong>{formatMoney(Math.abs(resumen.neto))}</strong></span>
      </div>
      {resumen.faltan > 0 && <p className="form-hint danger">Revisá {resumen.faltan === 1 ? 'un pedido' : `${resumen.faltan} pedidos`}: elegí la forma de cobro y que los importes sumen el saldo.</p>}
      {faltaPos && resumen.faltan === 0 && <p className="form-hint danger">Elegí la máquina POS y escribí el monto de su resumen para rendir.</p>}
      {error && <div className="alert error" role="alert">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancelar</button>
        <button className="primary" disabled={busy || !elegidos.length || resumen.faltan > 0 || faltaPos || !data.caja_abierta || !efectivo}>{busy ? 'Registrando…' : `Rendir ${elegidos.length} ${elegidos.length === 1 ? 'pedido' : 'pedidos'}`}</button></div>
    </form>}
  </div></div>;
}
