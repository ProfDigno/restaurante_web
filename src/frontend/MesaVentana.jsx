import { useCallback, useEffect, useState } from 'react';
import MesaTablero from './MesaTablero.jsx';
import CuentaPedido from './CuentaPedido.jsx';
import './pedidos.css';

export default function MesaVentana() {
  const [access, setAccess] = useState('loading');
  const [user, setUser] = useState(null);
  const [accountId, setAccountId] = useState(null);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const busy = null;

  useEffect(() => { document.title = 'MESAS'; }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(data => {
      if (!active) return;
      const allowed = data?.user?.permisos?.includes('FORM_MESAS');
      setUser(allowed ? data.user : null);
      setAccess(allowed ? 'allowed' : 'denied');
    }).catch(() => { if (active) setAccess('denied'); });
    return () => { active = false; };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(''); }
    try {
      const response = await fetch('/api/mesas', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudieron cargar las mesas');
      setTables(previous => JSON.stringify(previous) === JSON.stringify(data.mesas) ? previous : data.mesas);
    } catch (cause) { if (!silent) setError(cause.message); }
    finally { if (!silent) setLoading(false); }
  }, []);

  useEffect(() => {
    if (access !== 'allowed') return;
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(true); }, 5000);
    return () => clearInterval(timer);
  }, [access, load]);

  if (access !== 'allowed') return <main className="mesa-window mesa-window-access"><div><h1>MESAS</h1><p>{access === 'loading' ? 'Cargando…' : 'Iniciá sesión con un usuario autorizado para ver las mesas.'}</p>{access === 'denied' && <a href="/">Ir a Restaurante Web</a>}</div></main>;
  return <main className="mesa-window">
    <MesaTablero tables={tables} loading={loading} error={error} busy={busy} onRefresh={() => load()} onOpen={id => window.open(`/pedido?mesa=${id}`, 'pedido')}
      onViewAccount={setAccountId} />
    {accountId && <CuentaPedido accountId={accountId} user={user} onClose={() => { setAccountId(null); void load(true); }} onUpdated={() => load(true)} />}
  </main>;
}
