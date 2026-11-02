import { useEffect, useState } from 'react';
import Pedidos from './Pedidos.jsx';
import './pedido-ventana.css';

const mobileQuery = '(max-width: 900px)';
const isMobileDevice = () => /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent) || window.matchMedia(mobileQuery).matches;

export default function PedidoVentana() {
  const [session, setSession] = useState({ access: 'loading', user: null });
  const [mobile, setMobile] = useState(isMobileDevice);

  useEffect(() => {
    const media = window.matchMedia(mobileQuery);
    const update = () => setMobile(isMobileDevice());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

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
  const cuentaId = Number(new URLSearchParams(window.location.search).get('cuenta'));
  const mesaId = Number(new URLSearchParams(window.location.search).get('mesa'));
  const context = Number.isInteger(cuentaId) && cuentaId > 0 ? { cuentaId } : Number.isInteger(mesaId) && mesaId > 0 ? { mesaId } : null;
  return <main className={`pos-window${mobile ? ' pos-mobile' : ''}`}><Pedidos user={session.user} context={context} pos /></main>;
}
