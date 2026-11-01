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
import Comanda from './Comanda.jsx';
import KpiPedidos from './KpiPedidos.jsx';
import GastoTipo from './GastoTipo.jsx';
import Gastos from './Gastos.jsx';
import KpiGastos from './KpiGastos.jsx';
import Compra from './Compra.jsx';
import Proveedor from './Proveedor.jsx';
import FormaPago from './FormaPago.jsx';
import Caja, { CajaOpenForm } from './Caja.jsx';
import Security from './Security.jsx';
import { formatMoney } from './formatters.js';

const money = formatMoney;

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
  </div></main>;
}

function Sidebar({ menu, active, setActive, collapsed, setCollapsed, user, onLogout }) {
  const [open, setOpen] = useState(() => Object.fromEntries(menu.map((s) => [s.id, true])));
  return <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
    <div className="sidebar-top"><div className="brand"><span className="brand-mark small">R</span>{!collapsed && <span>Restaurante<span className="brand-dot">.</span></span>}</div><button className="icon-button collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Contraer menú">{collapsed ? '›' : '‹'}</button></div>
    <nav className="nav">{menu.map((section) => <div className="nav-section" key={section.id}>
      {!collapsed && <button className="section-title" onClick={() => setOpen({ ...open, [section.id]: !open[section.id] })}><span><i>{section.icon}</i>{section.label}</span><span>{open[section.id] ? '⌃' : '⌄'}</span></button>}
      {(collapsed || open[section.id]) && section.items.map((item) => item.id === 'comanda'
        ? <a key={item.id} href="/comanda" target="_blank" rel="noopener noreferrer" title={collapsed ? item.label : undefined} className="nav-item"><span className="nav-icon">C</span>{!collapsed && <span>{item.label}</span>}</a>
        : <button key={item.id} title={collapsed ? item.label : undefined} className={`nav-item ${active === item.id ? 'active' : ''}`} onClick={() => setActive(item.id)}><span className="nav-icon">{item.label.slice(0, 1)}</span>{!collapsed && <span>{item.label}</span>}</button>)}
    </div>)}</nav>
    <div className="sidebar-user"><div className="avatar">{user.nombre.slice(0, 1)}</div>{!collapsed && <div className="user-copy"><strong>{user.nombre}</strong><span>{user.rol}</span></div>}{!collapsed && <button className="logout" onClick={onLogout}>Salir</button>}</div>
  </aside>;
}

function Header({ active, user, onOpenMenu, section }) {
  return <header className="topbar"><button className="mobile-menu" onClick={onOpenMenu}>☰</button><div><p className="breadcrumb">{section || 'Operación'} <span>/</span> {active}</p><h1>{active === 'mesas' ? 'Mesas' : active.replaceAll('-', ' ')}</h1></div><div className="topbar-actions"><span className="connection"><span className="status-dot" /> Conectado</span><div className="top-avatar">{user.nombre.slice(0, 1)}</div></div></header>;
}

function Tables({ tables, loading, error, onOpen, onClose, onRefresh, busy }) {
  if (loading) return <div className="empty-state"><div className="loader" />Cargando mesas…</div>;
  if (error) return <div className="alert error">{error}</div>;
  const free = tables.filter((t) => t.estado === 'libre').length;
  const occupied = tables.filter((t) => t.estado === 'ocupado').length;
  return <>
    <div className="page-intro"><div><p className="eyebrow">SALÓN</p><h2>Estado del salón</h2><p className="muted">Abrí una cuenta cuando llegue el primer cliente y acumulá sus pedidos.</p></div><button className="secondary" onClick={onRefresh}>Actualizar</button></div>
    <div className="stat-row"><div className="stat-card"><span className="stat-label">Mesas totales</span><strong>{tables.length}</strong><span className="stat-caption">Capacidad configurada</span></div><div className="stat-card free"><span className="stat-label">Disponibles</span><strong>{free}</strong><span className="stat-caption">Listas para recibir</span></div><div className="stat-card busy"><span className="stat-label">Ocupadas</span><strong>{occupied}</strong><span className="stat-caption">Con cuenta abierta</span></div></div>
    <div className="table-grid">{tables.map((table) => <article className={`table-card ${table.estado}`} key={table.idmesa}><div className="table-card-head"><span className="table-number">Mesa {table.numero}</span><span className={`pill ${table.estado}`}>{table.estado === 'libre' ? 'Libre' : 'Ocupada'}</span></div><div className="table-visual"><div className="table-shape"><span>{table.numero}</span></div><span className="capacity">◉ {table.capacidad} personas</span></div><div className="table-meta"><span>{table.ubicacion || 'Salón'}</span>{table.estado === 'ocupado' && <strong>{money(table.total)}</strong>}</div>{table.estado === 'libre' ? <button disabled={busy === table.idmesa} className="primary full" onClick={() => onOpen(table.idmesa)}>{busy === table.idmesa ? 'Abriendo…' : 'Abrir cuenta'}</button> : <button disabled={busy === table.idcuenta} className="outline full" onClick={() => onClose(table.idcuenta)}>{busy === table.idcuenta ? 'Cerrando…' : 'Ver cuenta / Pedidos'}</button>}</article>)}</div>
  </>;
}

function Placeholder({ active }) { return <div className="placeholder"><div className="placeholder-icon">✦</div><h2>{active.replaceAll('-', ' ')}</h2><p className="muted">Este módulo ya está disponible en el menú. Vamos a construir su pantalla conectada a la base de datos en el próximo paso.</p></div>; }

function MainApp() {
  const [orderContext, setOrderContext] = useState(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const navigate = (id) => { if (orderDirty && !window.confirm('Hay cambios sin guardar. ¿Querés salir?')) return; setOrderDirty(false); setOrderContext(null); setActive(id); setMobileOpen(false); };

  const [user, setUser] = useState(null); const [menu, setMenu] = useState([]); const [cashOpen, setCashOpen] = useState(null); const [active, setActive] = useState('mesas'); const [collapsed, setCollapsed] = useState(false); const [mobileOpen, setMobileOpen] = useState(false); const [tables, setTables] = useState([]); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(null);
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
  return <div className="app-shell"><div className={`mobile-overlay ${mobileOpen ? 'show' : ''}`} onClick={() => setMobileOpen(false)} /><div className={`sidebar-wrap ${mobileOpen ? 'open' : ''}`}><Sidebar menu={menu} active={active} setActive={navigate} collapsed={collapsed} setCollapsed={setCollapsed} user={user} onLogout={logout} /></div><main className="content"><Header section={menu.find(s => s.items.some(i => i.id === active))?.label} active={current?.label || active} user={user} onOpenMenu={() => setMobileOpen(true)} /><section className="page-content">{!current ? <div className="empty-state">No tenés formularios asignados.</div> : active === 'mesas' ? <Tables tables={tables} loading={loading} error={error} busy={busy} onRefresh={load} onOpen={(id) => doAction(`/api/mesas/${id}/abrir`, id)} onClose={(id) => { setOrderContext({ cuentaId: id }); setActive('pedidos'); }} /> : active === 'historial-mesas' ? <MesaHistorial /> : active === 'pedidos' ? <Pedidos user={user} context={orderContext} onDirtyChange={setOrderDirty} /> : active === 'kpi-pedidos' ? <KpiPedidos /> : active === 'gasto-tipos' ? <GastoTipo /> : active === 'gastos' ? <Gastos /> : active === 'kpi-gastos' ? <KpiGastos /> : active === 'compras' ? <Compra user={user} /> : active === 'proveedores' ? <Proveedor /> : active === 'formas-pago' ? <FormaPago /> : active === 'caja' ? <Caja /> : active === 'ubicaciones-mesa' ? <UbicacionMesa /> : active === 'mesas-config' ? <Mesa /> : active === 'delivery' ? <EntregadorDelivery /> : active === 'ingredientes' ? <Ingrediente /> : active === 'unidades-medida' ? <UnidadMedida /> : active === 'conversiones-unidad' ? <UnidadConversion /> : active === 'grupos' ? <GrupoMenu /> : active === 'categorias' ? <CategoriaMenu /> : active === 'unidades-menu' ? <UnidadMenu /> : active === 'menu' ? <ProductoMenu /> : active === 'zonas' ? <ZonaCliente /> : active === 'clientes' ? <Cliente /> : ['usuarios', 'roles', 'permisos'].includes(active) ? <Security key={active} kind={active} onAccessChange={refreshSession} /> : <Placeholder active={current?.label || active} />}</section></main></div>;
}

export default function App() {
  return window.location.pathname === '/comanda' ? <Comanda /> : <MainApp />;
}
