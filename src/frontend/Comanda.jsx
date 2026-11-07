import { useEffect, useRef, useState } from 'react';
import { mutate } from './pedidos-api.js';
import './comanda.css';

const deliveryName = { COMER_ACA: 'COMER ACÁ', DELIVERY: 'DELIVERY', BUSCAR: 'RETIRAR' };
const deliveryClass = { COMER_ACA: 'eat-in', DELIVERY: 'delivery', BUSCAR: 'pickup' };
const pad = value => String(value).padStart(2, '0');
const elapsed = seconds => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
// Respaldo mientras llega la configuración del servidor (Configuración del sistema → Comanda).
const DEFAULT_CONFIG = {
  refresco_seg: 3, anulado_visible_seg: 30,
  colores: [{ desde_minuto: 0, color: '#ffffff' }, { desde_minuto: 10, color: '#fff09a' }, { desde_minuto: 20, color: '#ffc287' },
    { desde_minuto: 30, color: '#c8ced1' }, { desde_minuto: 40, color: '#a8d6f4' }, { desde_minuto: 50, color: '#ffb3b3' }]
};
// Color del último tramo cuyo minuto de inicio ya se alcanzó.
const ageColor = (seconds, colores) => colores.reduce((found, tramo) => seconds >= tramo.desde_minuto * 60 ? tramo.color : found, colores[0].color);
// Aun en vivo, recarga cada tanto por si se perdió algún aviso.
const SAFETY_RELOAD_MS = 60000;
const ageStep =(seconds, colores) => colores.reduce((found, tramo, index) => seconds >= tramo.desde_minuto * 60 ? index : found, 0);

export default function Comanda() {
  const [access, setAccess] = useState('loading');
  const [items, setItems] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(null);
  const [live, setLive] = useState(false);
  const liveRef = useRef(false);
  const loadRef = useRef(null);
  const lastLoadRef = useRef(0);

  useEffect(() => { document.title = 'COMANDA'; }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(data => {
      if (!active) return;
      setAccess(data?.user?.permisos?.includes('FORM_COMANDA') ? 'allowed' : 'denied');
    }).catch(() => { if (active) setAccess('denied'); });
    return () => { active = false; };
  }, []);

  // Carga + avisos en vivo (Server-Sent Events). Si la conexión en vivo se corta,
  // el intervalo de abajo vuelve a consultar cada refresco_seg hasta que se recupere.
  useEffect(() => {
    if (access !== 'allowed') return;
    let active = true, loading = false, again = false;
    const load = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        const response = await fetch('/api/comandas', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las comandas');
        if (active) { setItems(data.items); if (data.config?.colores?.length) setConfig(data.config); setFetchedAt(Date.now()); setError(''); }
      } catch (cause) { if (active) setError(cause.message); }
      finally {
        lastLoadRef.current = Date.now();
        loading = false;
        if (again && active) { again = false; void load(); }
      }
    };
    loadRef.current = load;
    void load();
    const events = typeof EventSource === 'function' ? new EventSource('/api/comandas/eventos') : null;
    if (events) {
      events.onopen = () => { liveRef.current = true; setLive(true); void load(); };
      events.onerror = () => { liveRef.current = false; setLive(false); };
      events.addEventListener('cambio', () => void load());
    }
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; events?.close(); liveRef.current = false; clearInterval(clock); };
  }, [access]);

  useEffect(() => {
    if (access !== 'allowed') return;
    const refresh = setInterval(() => {
      if (!liveRef.current || Date.now() - lastLoadRef.current > SAFETY_RELOAD_MS) void loadRef.current?.();
    }, config.refresco_seg * 1000);
    return () => clearInterval(refresh);
  }, [access, config.refresco_seg]);

  const finish = async item => {
    setFinishing(item.idpedido);
    setError('');
    try {
      await mutate(`/api/comandas/${item.idpedido}/terminar`, { version_web: item.version_web });
      setItems(current => current.filter(order => order.idpedido !== item.idpedido));
    } catch (cause) { setError(cause.message); }
    finally { setFinishing(null); }
  };

  if (access !== 'allowed') return <main className="comanda-page"><div className="comanda-access"><h1>COMANDA</h1><p>{access === 'loading' ? 'Cargando…' : 'Iniciá sesión con un usuario autorizado para ver las comandas.'}</p>{access === 'denied' && <a href="/">Ir a Restaurante Web</a>}</div></main>;
  const visible = items.filter(item => item.estado !== 'cancelado' || item.anulado_segundos + (now - fetchedAt) / 1000 < config.anulado_visible_seg);
  const waiting = visible.filter(item => item.estado !== 'cancelado');
  const counts = config.colores.map(() => 0);
  for (const item of waiting) counts[ageStep(Math.max(0, item.edad_segundos + Math.floor((now - fetchedAt) / 1000)), config.colores)] += 1;
  return <main className="comanda-page">
    <p className="comanda-legend" aria-label="Tiempo, color y cantidad de comandas">
      <span>Tiempo:</span>
      {config.colores.map((tramo, index) => <span className={`comanda-legend-item${counts[index] ? '' : ' is-empty'}`} key={tramo.desde_minuto}><i style={{ background: tramo.color }} />{tramo.desde_minuto}′ · {counts[index]}</span>)}
      <span>{config.limite_terminado_min ? `Pasa a TERMINADO a los ${config.limite_terminado_min}′` : 'Sin pase automático'} · {waiting.length} en total</span>
      <span className={`comanda-live${live ? ' is-live' : ''}`}>{live ? '● En vivo' : `○ Cada ${config.refresco_seg} s`}</span>
    </p>
    {error && <div className="comanda-error" role="alert">{error}</div>}
    <section className="comanda-grid" aria-label="Pedidos de cocina">
      {visible.length === 0 && <div className="comanda-empty">No hay pedidos en cocina.</div>}
      {visible.map(item => {
        const seconds = Math.max(0, item.edad_segundos + Math.floor((now - fetchedAt) / 1000));
        const cancelled = item.estado === 'cancelado';
        return <article className={`comanda-card${cancelled ? ' cancelled' : ''}`} style={cancelled ? undefined : { background: ageColor(seconds, config.colores) }} key={item.idpedido}>
          <div className="comanda-card-head"><span>PEDIDO #{item.idpedido}</span><time aria-label={`${Math.floor(seconds / 60)} minutos y ${seconds % 60} segundos`}>{elapsed(seconds)}</time></div>
          <div className="comanda-destination"><strong className={deliveryClass[item.tipo_entrega] || ''}>{deliveryName[item.tipo_entrega] || item.tipo_entrega}</strong>{item.mesa_numero && <strong className="comanda-table">MESA {item.mesa_numero}</strong>}</div>
          {item.cliente_nombre && <p className="comanda-client" title={item.cliente_nombre}>{item.cliente_nombre}</p>}
          {cancelled && <div className="comanda-cancelled">ANULADO</div>}
          <div className="comanda-lines">{item.detalles.map(line => <div className="comanda-line" key={line.iddetalle_pedido}>
            <div className="comanda-product"><strong className="comanda-quantity">{line.cantidad} ×</strong><strong>{line.categoria} · {line.unidad} · {line.nombre}</strong></div>
            {line.descripcion && <p className="comanda-description">{line.descripcion}</p>}
            {line.agregados.map((name, index) => <p className="comanda-change" key={`add-${index}`}>+ Con {name}</p>)}
            {line.quitados.map((name, index) => <p className="comanda-change" key={`remove-${index}`}>− Sin {name}</p>)}
            {line.observaciones && <p className="comanda-note">Obs: {line.observaciones}</p>}
          </div>)}</div>
          {item.observacion && <p className="comanda-order-note">Pedido: {item.observacion}</p>}
          {!cancelled && <button type="button" className="comanda-finish" disabled={finishing !== null} onClick={() => finish(item)}>{finishing === item.idpedido ? 'Terminando…' : 'TERMINAR'}</button>}
        </article>;
      })}
    </section>
  </main>;
}
