import { useEffect, useState } from 'react';
import { mutate } from './pedidos-api.js';
import './comanda.css';

const deliveryName = { COMER_ACA: 'COMER ACÁ', DELIVERY: 'DELIVERY', BUSCAR: 'RETIRAR' };
const deliveryClass = { COMER_ACA: 'eat-in', DELIVERY: 'delivery', BUSCAR: 'pickup' };
const pad = value => String(value).padStart(2, '0');
const elapsed = seconds => `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`;
const ageClass = seconds => {
  if (seconds < 600) return 'white';
  if (seconds < 1200) return 'yellow';
  if (seconds < 1800) return 'orange';
  if (seconds < 2400) return 'gray';
  if (seconds < 3000) return 'blue';
  return 'red';
};

export default function Comanda() {
  const [access, setAccess] = useState('loading');
  const [items, setItems] = useState([]);
  const [fetchedAt, setFetchedAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [finishing, setFinishing] = useState(null);

  useEffect(() => { document.title = 'COMANDA'; }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(data => {
      if (!active) return;
      setAccess(data?.user?.permisos?.includes('FORM_COMANDA') ? 'allowed' : 'denied');
    }).catch(() => { if (active) setAccess('denied'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (access !== 'allowed') return;
    let active = true;
    const load = async () => {
      try {
        const response = await fetch('/api/comandas', { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las comandas');
        if (active) { setItems(data.items); setFetchedAt(Date.now()); setError(''); }
      } catch (cause) { if (active) setError(cause.message); }
    };
    void load();
    const refresh = setInterval(load, 3000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; clearInterval(refresh); clearInterval(clock); };
  }, [access]);

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
  const visible = items.filter(item => item.estado !== 'cancelado' || item.anulado_segundos + (now - fetchedAt) / 1000 < 30);
  return <main className="comanda-page">
    <header className="comanda-header"><div><span>OPERACIÓN</span><h1>COMANDA</h1></div><strong>{visible.filter(item => item.estado !== 'cancelado').length} EN COCINA</strong></header>
    {error && <div className="comanda-error" role="alert">{error}</div>}
    <section className="comanda-grid" aria-label="Pedidos de cocina">
      {visible.length === 0 && <div className="comanda-empty">No hay pedidos en cocina.</div>}
      {visible.map(item => {
        const seconds = Math.max(0, item.edad_segundos + Math.floor((now - fetchedAt) / 1000));
        const cancelled = item.estado === 'cancelado';
        return <article className={`comanda-card ${cancelled ? 'cancelled' : ageClass(seconds)}`} key={item.idpedido}>
          <div className="comanda-card-head"><span>PEDIDO #{item.idpedido}</span><time aria-label={`${Math.floor(seconds / 60)} minutos y ${seconds % 60} segundos`}>{elapsed(seconds)}</time></div>
          <div className="comanda-destination"><strong className={deliveryClass[item.tipo_entrega] || ''}>{deliveryName[item.tipo_entrega] || item.tipo_entrega}</strong>{item.mesa_numero && <strong className="comanda-table">MESA {item.mesa_numero}</strong>}</div>
          {cancelled && <div className="comanda-cancelled">ANULADO</div>}
          <div className="comanda-lines">{item.detalles.map(line => <div className="comanda-line" key={line.iddetalle_pedido}>
            <div className="comanda-product"><strong className="comanda-quantity">{line.cantidad} ×</strong><strong>{line.categoria} · {line.unidad} · {line.nombre}</strong></div>
            {line.descripcion && <p className="comanda-description">{line.descripcion}</p>}
            {line.agregados.map((name, index) => <p className="comanda-change" key={`add-${index}`}>+ Con {name}</p>)}
            {line.quitados.map((name, index) => <p className="comanda-change" key={`remove-${index}`}>− Sin {name}</p>)}
            {line.observaciones && <p className="comanda-note">Nota: {line.observaciones}</p>}
          </div>)}</div>
          {item.observacion && <p className="comanda-order-note">Pedido: {item.observacion}</p>}
          {!cancelled && <button type="button" className="comanda-finish" disabled={finishing !== null} onClick={() => finish(item)}>{finishing === item.idpedido ? 'Terminando…' : 'TERMINAR'}</button>}
        </article>;
      })}
    </section>
  </main>;
}
