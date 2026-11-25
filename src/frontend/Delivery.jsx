import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { formatMoney } from './formatters.js';
import './delivery.css';

// Panel del entregador (/delivery), pensado para celular. Sesión propia con usuario y PIN de 4 números.
async function api(path, options = {}) {
  const response = await fetch(`/api/delivery-app${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'No se pudo completar la operación'); error.status = response.status; throw error; }
  return data;
}

function MotoLogo({ size = 96 }) {
  return (
    <svg className="dl-logo" width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Moto de delivery">
      <circle cx="60" cy="60" r="58" className="dl-logo-bg" />
      <path d="M14 86h92" className="dl-logo-road" />
      {/* caja de reparto */}
      <rect x="22" y="38" width="30" height="26" rx="4" className="dl-logo-box" />
      <path d="M22 47h30M37 38v9" className="dl-logo-box-line" />
      {/* cuerpo de la moto */}
      <path d="M30 70h26l10-14h14l8 14" className="dl-logo-body" />
      <path d="M52 64h14l-6-10" className="dl-logo-body" />
      <path d="M78 56l-4-12h-8" className="dl-logo-body" />
      <path d="M70 44h10" className="dl-logo-handle" />
      {/* conductor */}
      <circle cx="62" cy="30" r="7" className="dl-logo-helmet" />
      <path d="M60 37l-4 15h12l6-6" className="dl-logo-rider" />
      {/* ruedas */}
      <circle cx="36" cy="76" r="10" className="dl-logo-wheel" />
      <circle cx="36" cy="76" r="3" className="dl-logo-hub" />
      <circle cx="86" cy="76" r="10" className="dl-logo-wheel" />
      <circle cx="86" cy="76" r="3" className="dl-logo-hub" />
      {/* líneas de velocidad */}
      <path d="M8 58h10M4 66h12M10 50h8" className="dl-logo-speed" />
    </svg>
  );
}

function Login({ onLogged }) {
  const [nombre, setNombre] = useState('');
  const [usuario, setUsuario] = useState(() => localStorage.getItem('delivery_usuario') || '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const pinInput = useRef(null);
  const userInput = useRef(null);

  useEffect(() => { api('/info').then(d => setNombre(d.nombre)).catch(() => {}); }, []);
  useEffect(() => { (usuario ? pinInput : userInput).current?.focus(); }, []);

  const submit = async (value) => {
    if (!usuario.trim()) { setError('Ingresá tu usuario'); userInput.current?.focus(); return; }
    setBusy(true); setError('');
    try {
      const data = await api('/login', { method: 'POST', body: { login: usuario.trim(), pin: value } });
      localStorage.setItem('delivery_usuario', usuario.trim());
      onLogged(data.entregador);
    } catch (e) {
      setError(e.message); setPin(''); setShake(true);
      setTimeout(() => setShake(false), 450);
    } finally { setBusy(false); }
  };
  const setDigits = (value) => {
    const clean = value.replace(/\D/g, '').slice(0, 4);
    setPin(clean); setError('');
    if (clean.length === 4) submit(clean);
  };
  const press = (digit) => { if (!busy && pin.length < 4) setDigits(pin + digit); };
  const erase = () => { if (!busy) setPin(pin.slice(0, -1)); };

  return (
    <main className="dl-login">
      <div className="dl-login-head">
        <MotoLogo />
        <p className="dl-brand">{nombre || 'Delivery'}</p>
        <h1>Ingreso de entregadores</h1>
      </div>
      <form className="dl-login-form" onSubmit={e => { e.preventDefault(); if (pin.length === 4) submit(pin); else pinInput.current?.focus(); }}>
        <label className="dl-field">
          <span>Usuario</span>
          <input ref={userInput} value={usuario} onChange={e => { setUsuario(e.target.value.replace(/\s/g, '')); setError(''); }}
            autoCapitalize="none" autoCorrect="off" autoComplete="username" maxLength={50} placeholder="Tu usuario"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); pinInput.current?.focus(); } }} />
        </label>
        <div className="dl-pin-label">PIN</div>
        <div className={`dl-pin-dots${shake ? ' shake' : ''}`} onClick={() => pinInput.current?.focus()} aria-label={`${pin.length} de 4 números ingresados`}>
          {[0, 1, 2, 3].map(i => <span key={i} className={i < pin.length ? 'filled' : ''} />)}
        </div>
        <input ref={pinInput} className="dl-pin-hidden" type="password" inputMode="numeric" autoComplete="current-password"
          value={pin} onChange={e => setDigits(e.target.value)} maxLength={4} aria-label="PIN de 4 números" />
        {error && <div className="dl-error" role="alert">{error}</div>}
        <div className="dl-keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <button type="button" key={d} onClick={() => press(d)} disabled={busy}>{d}</button>)}
          <span />
          <button type="button" onClick={() => press('0')} disabled={busy}>0</button>
          <button type="button" className="dl-key-erase" onClick={erase} disabled={busy || !pin} aria-label="Borrar">⌫</button>
        </div>
        {busy && <p className="dl-muted dl-center">Ingresando…</p>}
      </form>
    </main>
  );
}

const ESTADOS = { confirmado: 'Confirmado', en_preparacion: 'En cocina', listo: 'Listo', entregado: 'Entregado', pagado: 'Pagado' };

function PedidoCard({ pedido, formas, onAsignar, onForma, busy }) {
  const [cambiar, setCambiar] = useState(false);
  const mostrarFormas = pedido.puede_indicar_forma && (!pedido.fk_idforma_pago_entrega || cambiar);
  return (
    <article className={`dl-card${pedido.mio ? ' mine' : ''}`}>
      <header className="dl-card-head">
        <div>
          <strong className="dl-card-num">Pedido N.º {pedido.idpedido}</strong>
          <span className="dl-muted">{pedido.fecha} · {pedido.hora}</span>
        </div>
        <span className={`dl-badge ${pedido.estado}`}>{ESTADOS[pedido.estado] || pedido.estado}</span>
      </header>
      <section className="dl-client">
        <strong>{pedido.cliente || 'Cliente'}</strong>
        {pedido.direccion && <span>📍 {pedido.direccion}{pedido.zona ? ` · ${pedido.zona}` : ''}</span>}
        {pedido.telefono && <a href={`tel:${pedido.telefono.replace(/[^\d+]/g, '')}`}>📞 {pedido.telefono}</a>}
        {pedido.observacion && <span className="dl-obs">Obs: {pedido.observacion}</span>}
      </section>
      <ul className="dl-lines">
        {pedido.productos.map((p, i) => <li key={i}><span><b>{p.cantidad}×</b> {p.nombre}</span><span>{formatMoney(p.subtotal)}</span></li>)}
      </ul>
      <dl className="dl-totals">
        {pedido.descuento > 0 && <><dt>Descuento</dt><dd>− {formatMoney(pedido.descuento)}</dd></>}
        {pedido.recargo > 0 && <><dt>Recargo</dt><dd>{formatMoney(pedido.recargo)}</dd></>}
        <dt>Delivery</dt><dd>{formatMoney(pedido.delivery)}</dd>
        <dt className="dl-total">Total</dt><dd className="dl-total">{formatMoney(pedido.total)}</dd>
        {pedido.saldo > 0 && pedido.saldo !== pedido.total && <><dt>A cobrar</dt><dd>{formatMoney(pedido.saldo)}</dd></>}
      </dl>
      {!pedido.mio && <button className="dl-primary" disabled={busy} onClick={() => onAsignar(pedido)}>🛵 Asignarme este pedido</button>}
      {pedido.mio && (
        <div className="dl-pay">
          {pedido.formas_cobradas ? <p className="dl-pay-info ok">Cobrado: <b>{pedido.formas_cobradas}</b></p>
            : pedido.rendido ? <p className="dl-pay-info ok">Rendido{pedido.forma_pago_entrega ? ` · ${pedido.forma_pago_entrega}` : ''}</p>
            : pedido.fk_idforma_pago_entrega && !cambiar ? (
              <p className="dl-pay-info">Paga con: <b>{pedido.forma_pago_entrega}</b>
                {pedido.puede_indicar_forma && <button className="dl-link" onClick={() => setCambiar(true)}>Cambiar</button>}</p>
            ) : null}
          {mostrarFormas && (
            <>
              <p className="dl-pay-title">¿Cómo paga el cliente?</p>
              <div className="dl-pay-options">
                {formas.map(f => <button key={f.idforma_pago} disabled={busy}
                  className={f.idforma_pago === pedido.fk_idforma_pago_entrega ? 'selected' : ''}
                  onClick={async () => { if (await onForma(pedido, f)) setCambiar(false); }}>{f.nombre}</button>)}
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}

// Neto = efectivo cobrado − delivery. Positivo: ya se quedó con su ganancia y entrega el resto.
// Negativo: el efectivo no cubre su delivery y la caja le paga la diferencia.
function Neto({ neto, delivery }) {
  const positivo = neto >= 0;
  return (
    <div className={`dl-neto ${positivo ? 'ok' : 'debe'}`}>
      {positivo ? (
        <>
          <span className="dl-neto-label">Tu ganancia</span>
          <strong>{formatMoney(delivery)}</strong>
          <span className="dl-neto-sub">Entregás a la caja: <b>{formatMoney(neto)}</b></span>
        </>
      ) : (
        <>
          <span className="dl-neto-label">La caja te paga</span>
          <strong>− {formatMoney(-neto)}</strong>
          <span className="dl-neto-sub">El efectivo no cubre tu delivery de {formatMoney(delivery)}</span>
        </>
      )}
    </div>
  );
}

function Totales({ totales }) {
  if (!totales?.pedidos) return <div className="dl-empty"><b>Todavía no tenés pedidos en este turno</b><span>Cuando te asignes pedidos vas a ver acá tus totales.</span></div>;
  const t = totales;
  return (
    <section className="dl-totales">
      <Neto neto={t.neto} delivery={t.delivery} />
      {t.sin_forma > 0 && <div className="dl-warn">{t.sin_forma === 1 ? '1 pedido sin forma de pago: se cuenta' : `${t.sin_forma} pedidos sin forma de pago: se cuentan`} como efectivo.</div>}
      <dl className="dl-totals dl-card">
        <dt>Pedidos del turno</dt><dd>{t.pedidos}</dd>
        <dt>Efectivo cobrado</dt><dd>{formatMoney(t.efectivo)}</dd>
        {t.pos.map(p => <Fragment key={p.nombre}><dt className="dl-indent">POS · {p.nombre}</dt><dd>{formatMoney(p.monto)}</dd></Fragment>)}
        <dt>Total POS</dt><dd>{formatMoney(t.pos_total)}</dd>
        {t.otros > 0 && <><dt>Otros cobros</dt><dd>{formatMoney(t.otros)}</dd></>}
        <dt>Tu delivery</dt><dd>{formatMoney(t.delivery)}</dd>
        <dt className="dl-total">{t.neto >= 0 ? 'Entregás a la caja' : 'La caja te paga'}</dt>
        <dd className={`dl-total ${t.neto >= 0 ? '' : 'dl-rojo'}`}>{formatMoney(Math.abs(t.neto))}</dd>
      </dl>
      {t.pos_total > 0 && <p className="dl-muted dl-center">El total POS debe coincidir con el reporte que imprime cada máquina.</p>}
      <div className="dl-card dl-split">
        <div><span>Ya rendido</span><b>{t.rendido.pedidos} {t.rendido.pedidos === 1 ? 'pedido' : 'pedidos'}</b>
          <small>{t.rendido.pedidos ? (t.rendido.neto >= 0 ? `Entregaste ${formatMoney(t.rendido.neto)}` : `Te pagaron ${formatMoney(-t.rendido.neto)}`) : '—'}</small></div>
        <div><span>Falta rendir</span><b>{t.pendiente.pedidos} {t.pendiente.pedidos === 1 ? 'pedido' : 'pedidos'}</b>
          {t.pendiente.pedidos > 0
            ? <strong className={t.pendiente.neto >= 0 ? 'dl-verde' : 'dl-rojo'}>{t.pendiente.neto >= 0 ? `Entregás ${formatMoney(t.pendiente.neto)}` : `Te pagan ${formatMoney(-t.pendiente.neto)}`}</strong>
            : <small>Nada pendiente</small>}</div>
      </div>
    </section>
  );
}

function Panel({ entregador, onLogout }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('mios');
  const [error, setError] = useState('');
  const [confirmar, setConfirmar] = useState(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const tabElegida = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await api('/pedidos');
      setData(d); setError('');
      // Al entrar, si no tiene pedidos propios pero hay libres, abre "Disponibles".
      if (!tabElegida.current) { tabElegida.current = true; if (!d.pedidos.some(p => p.mio) && d.pedidos.some(p => !p.mio)) setTab('libres'); }
    } catch (e) { if (e.status === 401) onLogout(); else setError(e.message); }
  }, [onLogout]);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 20000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  const avisar = (message) => { setToast(message); setTimeout(() => setToast(''), 3000); };
  const asignar = async () => {
    const pedido = confirmar; setBusy(true);
    try {
      await api(`/pedidos/${pedido.idpedido}/asignarme`, { method: 'POST', body: {} });
      setConfirmar(null); setTab('mios'); avisar(`Pedido N.º ${pedido.idpedido} asignado a vos`);
    } catch (e) { setConfirmar(null); if (e.status === 401) return onLogout(); avisar(e.message); }
    finally { setBusy(false); load(); }
  };
  const indicarForma = async (pedido, forma) => {
    setBusy(true);
    try {
      await api(`/pedidos/${pedido.idpedido}/forma-pago`, { method: 'PUT', body: { fk_idforma_pago: forma.idforma_pago } });
      avisar(`Pedido N.º ${pedido.idpedido}: paga con ${forma.nombre}`);
      await load();
      return true;
    } catch (e) { if (e.status === 401) onLogout(); else avisar(e.message); return false; }
    finally { setBusy(false); }
  };
  const salir = async () => { await api('/logout', { method: 'POST' }).catch(() => {}); onLogout(); };

  const pedidos = data?.pedidos || [];
  const mios = pedidos.filter(p => p.mio);
  const libres = pedidos.filter(p => !p.mio);
  const lista = tab === 'mios' ? mios : libres;

  return (
    <div className="dl-panel">
      <header className="dl-top">
        <MotoLogo size={40} />
        <div className="dl-top-name"><span className="dl-muted">Entregador</span><strong>{entregador.nombre}</strong></div>
        <button className="dl-logout" onClick={salir}>Salir</button>
      </header>
      <nav className="dl-tabs">
        <button className={tab === 'mios' ? 'active' : ''} onClick={() => setTab('mios')}>Mis pedidos <em>{mios.length}</em></button>
        <button className={tab === 'libres' ? 'active' : ''} onClick={() => setTab('libres')}>Disponibles <em className={libres.length ? 'hot' : ''}>{libres.length}</em></button>
        <button className={tab === 'totales' ? 'active' : ''} onClick={() => setTab('totales')}>Totales</button>
      </nav>
      <main className="dl-list">
        {error && <div className="dl-error">{error}</div>}
        {!data ? <p className="dl-empty">Cargando pedidos…</p>
          : !data.caja_abierta ? <div className="dl-empty"><b>No hay caja abierta</b><span>Los pedidos aparecen cuando se abre la caja.</span></div>
          : tab === 'totales' ? <Totales totales={data.totales} />
          : lista.length === 0 ? <div className="dl-empty"><b>{tab === 'mios' ? 'No tenés pedidos asignados' : 'No hay pedidos disponibles'}</b>
              <span>{tab === 'mios' ? 'Tomá uno desde "Disponibles".' : 'Cuando entre un pedido sin entregador lo vas a ver acá.'}</span></div>
          : lista.map(p => <PedidoCard key={p.idpedido} pedido={p} formas={data.formas} busy={busy} onAsignar={setConfirmar} onForma={indicarForma} />)}
      </main>
      {confirmar && (
        <div className="dl-modal-back" onClick={e => e.target === e.currentTarget && !busy && setConfirmar(null)}>
          <div className="dl-modal" role="dialog" aria-modal="true">
            <MotoLogo size={56} />
            <h2>¿Tomar el pedido N.º {confirmar.idpedido}?</h2>
            <p>{confirmar.cliente}{confirmar.direccion ? ` · ${confirmar.direccion}` : ''}</p>
            <p className="dl-modal-total">Total {formatMoney(confirmar.total)}</p>
            <div className="dl-modal-actions">
              <button className="dl-secondary" disabled={busy} onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="dl-primary" disabled={busy} onClick={asignar}>{busy ? 'Asignando…' : 'Sí, asignarme'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="dl-toast" role="status">{toast}</div>}
    </div>
  );
}

export default function Delivery() {
  const [entregador, setEntregador] = useState(undefined);
  useEffect(() => {
    document.title = 'Delivery';
    api('/me').then(d => setEntregador(d.entregador)).catch(() => setEntregador(null));
  }, []);
  const logout = useCallback(() => setEntregador(null), []);
  return (
    <div className="delivery-app">
      {entregador === undefined ? <p className="dl-empty">Cargando…</p>
        : entregador ? <Panel entregador={entregador} onLogout={logout} />
        : <Login onLogged={setEntregador} />}
    </div>
  );
}
