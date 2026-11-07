import { useEffect, useMemo, useState } from 'react';
import GrupoMenu from './GrupoMenu.jsx';
import CategoriaMenu from './CategoriaMenu.jsx';
import UnidadMenu from './UnidadMenu.jsx';
import ProductoMenu from './ProductoMenu.jsx';
import ZonaCliente from './ZonaCliente.jsx';
import Cliente from './Cliente.jsx';
import EntregadorDelivery from './EntregadorDelivery.jsx';
import UnidadMedida from './UnidadMedida.jsx';
import UnidadConversion from './UnidadConversion.jsx';
import Ingrediente from './Ingrediente.jsx';
import Mesa from './Mesa.jsx';
import MesaHistorial from './MesaHistorial.jsx';
import UbicacionMesa from './UbicacionMesa.jsx';
import Pedidos from './Pedidos.jsx';
import Factura from './Factura.jsx';
import DatosRestaurante from './DatosRestaurante.jsx';
import ComandaConfig from './ComandaConfig.jsx';
import Comanda from './Comanda.jsx';
import PedidoVentana from './PedidoVentana.jsx';
import MesaTablero from './MesaTablero.jsx';
import MesaVentana from './MesaVentana.jsx';
import KpiPedidos from './KpiPedidos.jsx';
import GastoTipo from './GastoTipo.jsx';
import Gastos from './Gastos.jsx';
import KpiGastos from './KpiGastos.jsx';
import Sidebar from './Sidebar.jsx';
import KpiCompras from './KpiCompras.jsx';
import Personal from './Personal.jsx';
import Vales from './Vales.jsx';
import Auditoria from './Auditoria.jsx';
import KpiRentabilidad from './KpiRentabilidad.jsx';
import KpiVales from './KpiVales.jsx';
import Cargos from './Cargos.jsx';
import Compra from './Compra.jsx';
import Proveedor from './Proveedor.jsx';
import FormaPago from './FormaPago.jsx';
import Caja, { CajaOpenForm } from './Caja.jsx';
import Security from './Security.jsx';
import { formatMoney } from './formatters.js';

const money = formatMoney;

// Inyectadas por Vite al compilar (vite.config.js); en desarrollo sin build quedan como 'dev'.
const appVersion = typeof __APP_VERSION__ === 'undefined' ? 'dev' : __APP_VERSION__;
const appBuildDate = typeof __APP_BUILD_DATE__ === 'undefined' ? '' : __APP_BUILD_DATE__;

function Login({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (event) => {
    event.preventDefault(); setError('');
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
    const data = await response.json();
    if (!response.ok) return setError(data.error || 'No se pudo iniciar sesión');
    onLogin(data);
  };
  return <main className="login-page"><div className="login-card">
    <div className="brand-mark">R</div><p className="eyebrow">RESTAURANTE WEB</p><h1>Bienvenido</h1><p className="muted">Ingresá para gestionar tu salón.</p>
    <form onSubmit={submit} className="login-form"><label>Usuario<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" placeholder="admin" /></label><label>Contraseña<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>{error && <div className="alert error">{error}</div>}<button className="primary full">Ingresar</button></form>
    <p className="login-version" title={`Compilado el ${appBuildDate}`}>Versión {appVersion}</p>
  </div></main>;
}

function Header({ active, onOpenMenu }) {
  return <header className="topbar"><button className="mobile-menu" onClick={onOpenMenu}>☰</button><div className="topbar-title"><h1>{active === 'mesas' ? 'Mesas' : active.replaceAll('-', ' ')}</h1><div id="topbar-sub" className="topbar-sub" /></div><div id="topbar-slot" className="topbar-slot" /></header>;
}

function Placeholder({ active }) { return <div className="placeholder"><div className="placeholder-icon">✦</div><h2>{active.replaceAll('-', ' ')}</h2><p className="muted">Este módulo ya está disponible en el menú. Vamos a construir su pantalla conectada a la base de datos en el próximo paso.</p></div>; }

function MainApp() {
  const [orderContext, setOrderContext] = useState(() => { const pedido = new URLSearchParams(window.location.search).get('factura'); return /^[0-9]+$/.test(pedido || '') ? { facturaPedidoId: Number(pedido) } : null; });
  const [orderDirty, setOrderDirty] = useState(false);
  const navigate = (id) => { if (orderDirty && !window.confirm('Hay cambios sin guardar. ¿Querés salir?')) return; setOrderDirty(false); setOrderContext(null); setActive(id); setMobileOpen(false); };

  const [user, setUser] = useState(null); const [menu, setMenu] = useState([]); const [cashOpen, setCashOpen] = useState(null); const [active, setActive] = useState(() => /^[0-9]+$/.test(new URLSearchParams(window.location.search).get('factura') || '') ? 'facturas' : 'mesas'); const [collapsed, setCollapsed] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [tables, setTables] = useState([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(null);
  const load = async () => { setLoading(true); setError(''); try { const r = await fetch('/api/mesas'); const d = await r.json(); if (!r.ok) throw new Error(d.error); setTables(d.mesas); } catch (e) { setError(e.message); } finally { setLoading(false); } };
  const applySession = (data) => { setUser(data.user); setMenu(data.menu); setActive(current => data.menu.some(section => section.items.some(item => item.id === current)) ? current : data.menu[0]?.items[0]?.id || ''); };
  const refreshSession = async () => { const response = await fetch('/api/auth/me'); if (response.status === 401) { setUser(null); setMenu([]); return; } if (response.ok) applySession(await response.json()); };
  const establishSession = async (data) => { applySession(data); setCashOpen(null); try { const response = await fetch('/api/cajas/estado'); const state = await response.json(); if (!response.ok) throw new Error(state.error || 'No se pudo consultar la caja'); setCashOpen(!!state.caja); } catch (e) { setError(e.message); setCashOpen(false); } };
  const logout = async () => { if (orderDirty && !window.confirm('Hay cambios sin guardar. ¿Querés salir?')) return; await fetch('/api/auth/logout', { method: 'POST' }); setUser(null); setMenu([]); setCashOpen(null); };
  useEffect(() => { fetch('/api/auth/me').then(async (r) => r.ok ? r.json() : null).then((d) => { if (d) establishSession(d); }); }, []);
  useEffect(() => { if (!user) return; const timer = setInterval(refreshSession, 15000); const onFocus = () => refreshSession(); window.addEventListener('focus', onFocus); return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); }; }, [!!user]);
  useEffect(() => { if (user && active === 'mesas') load(); }, [user, active]);
  const doAction = async (url, id) => { setBusy(id); setError(''); try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) }); const d = r.status === 204 ? null : await r.json(); if (!r.ok) throw new Error(d?.error || 'No se pudo completar la operación'); await load(); } catch (e) { setError(e.message); } finally { setBusy(null); } };
  const current = useMemo(() => menu.flatMap((s) => s.items).find((i) => i.id === active), [menu, active]);
  if (!user) return <Login onLogin={establishSession} />;
  if (cashOpen === null) return <main className="login-page"><div className="empty-state"><div className="loader" />Consultando caja…</div></main>;
  if (!cashOpen) return <CajaOpenForm gate user={user} onLogout={logout} onOpened={() => setCashOpen(true)} />;
  return <div className="app-shell"><div className={`mobile-overlay ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} /><div className={`sidebar-wrap ${mobileOpen ? 'open' : ''}`}><Sidebar menu={menu} active={active} setActive={navigate} collapsed={collapsed} setCollapsed={setCollapsed} user={user} onLogout={logout} /></div><main className="content"><Header active={current?.label || active} onOpenMenu={() => setMobileOpen(true)} /><section className="page-content">{!current ? <div className="empty-state">No tenés formularios asignados.</div> : active === 'mesas' ? <MesaTablero tables={tables} loading={loading} error={error} busy={busy} onRefresh={load} onOpen={(id) => { setOrderContext({ mesaId: id }); setActive('pedidos'); }} onViewAccount={(id) => { setOrderContext({ cuentaId: id }); setActive('pedidos'); }} /> : active === 'historial-mesas' ? <MesaHistorial /> : active === 'pedidos' ? <Pedidos user={user} context={orderContext} onDirtyChange={setOrderDirty} onInvoice={(pedidoId) => { setOrderDirty(false); setOrderContext({ facturaPedidoId: pedidoId }); setActive('facturas'); }} /> : active === 'facturas' ? <Factura pedidoId={orderContext?.facturaPedidoId || null} /> : active === 'datos-restaurante' ? <DatosRestaurante /> : active === 'configuracion-comanda' ? <ComandaConfig /> : active === 'kpi-pedidos' ? <KpiPedidos /> : active === 'kpi-rentabilidad' ? <KpiRentabilidad /> : active === 'gasto-tipos' ? <GastoTipo /> : active === 'gastos' ? <Gastos /> : active === 'kpi-gastos' ? <KpiGastos /> : active === 'kpi-compras' ? <KpiCompras /> : active === 'personal' ? <Personal /> : active === 'vales' ? <Vales /> : active === 'kpi-vales' ? <KpiVales /> : active === 'cargos' ? <Cargos /> : active === 'auditoria' ? <Auditoria /> : active === 'compras' ? <Compra user={user} /> : active === 'proveedores' ? <Proveedor /> : active === 'formas-pago' ? <FormaPago /> : active === 'caja' ? <Caja /> : active === 'ubicaciones-mesa' ? <UbicacionMesa /> : active === 'mesas-config' ? <Mesa /> : active === 'delivery' ? <EntregadorDelivery /> : active === 'ingredientes' ? <Ingrediente /> : active === 'unidades-medida' ? <UnidadMedida /> : active === 'conversiones-unidad' ? <UnidadConversion /> : active === 'grupos' ? <GrupoMenu /> : active === 'categorias' ? <CategoriaMenu /> : active === 'unidades-menu' ? <UnidadMenu /> : active === 'menu' ? <ProductoMenu /> : active === 'zonas' ? <ZonaCliente /> : active === 'clientes' ? <Cliente /> : ['usuarios', 'roles', 'permisos'].includes(active) ? <Security key={active} kind={active} onAccessChange={refreshSession} /> : <Placeholder active={current?.label || active} />}</section></main></div>;
}

export default function App() {
  const path = window.location.pathname;
  return path === '/comanda' ? <Comanda /> : path === '/pedido' ? <PedidoVentana /> : path === '/mesa' ? <MesaVentana /> : <MainApp />;
}
