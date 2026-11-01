import { useEffect, useState } from 'react';
import Pedidos from './Pedidos.jsx';
import './pedido-ventana.css';

export default function PedidoVentana() {
  const [session, setSession] = useState({ access: 'loading', user: null });

  useEffect(() => { document.title = 'PEDIDO'; }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/me').then(response => response.ok ? response.json() : null).then(data => {
      if (!active) return;
      const allowed = data?.user?.permisos?.includes('FORM_PEDIDOS');
      setSession({ access: allowed ? 'allowed' : 'denied', user: allowed ? data.user : null });
    }).catch(() => { if (active) setSession({ access: 'denied', user: null }); });
    return () => { active = false; };
  }, []);

  if (session.access !== 'allowed') return <main className="pos-window pos-access"><div><h1>PEDIDO</h1><p>{session.access === 'loading' ? 'Cargando…' : 'Iniciá sesión con un usuario autorizado para tomar pedidos.'}</p>{session.access === 'denied' && <a href="/">Ir a Restaurante Web</a>}</div></main>;
  return <main className="pos-window"><Pedidos user={session.user} context={null} pos /></main>;
}
