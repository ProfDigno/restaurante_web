import { useState } from 'react';
import './sidebar.css';

// Íconos de línea para cada sección del menú (24×24, trazo actual).
const paths = {
  operacion: <><path d="M4 11h16M6 11V7a6 6 0 0 1 12 0v4"/><path d="M3 15h18M8 15v4M16 15v4"/></>,
  usuarios: <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/></>,
  rrhh: <><circle cx="12" cy="7.5" r="3.5"/><path d="M5 20.5v-1a7 7 0 0 1 14 0v1"/><path d="M12 14.5v3M10.5 16h3"/></>,
  cliente: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  productos: <><path d="M4 9h16l-1.5 11h-13Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/></>,
  'mesas-configuracion': <><rect x="3" y="8" width="18" height="5" rx="1.5"/><path d="M6 13v7M18 13v7M9 4h6"/></>,
  finanzas: <><rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="M2.5 10h19M7 15h3"/></>,
  gasto: <><path d="M12 3v14M6 11l6 6 6-6"/><path d="M5 21h14"/></>,
  compra: <><path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2"/><circle cx="9.5" cy="20" r="1.2"/><circle cx="17" cy="20" r="1.2"/></>,
  inventario: <><path d="M3 7.5 12 3l9 4.5-9 4.5Z"/><path d="M3 7.5v9L12 21l9-4.5v-9M12 12v9"/></>,
  factura: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  'configuracion-sistema': <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.6 4.6l2.1 2.1M17.3 17.3l2.1 2.1M2.5 12h3M18.5 12h3M4.6 19.4l2.1-2.1M17.3 6.7l2.1-2.1"/></>
};
function SectionIcon({ id }) {
  return <svg className="side-icon-svg" viewBox="0 0 24 24" aria-hidden="true">{paths[id] || <circle cx="12" cy="12" r="7"/>}</svg>;
}
const Chevron = () => <svg className="side-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>;

// Menú lateral en acordeón: arranca con todas las secciones cerradas y abre una a la vez.
export default function Sidebar({ menu, active, setActive, collapsed, setCollapsed, user, onLogout }) {
  const [openId, setOpenId] = useState(null);
  const sectionOf = id => menu.find(section => section.items.some(item => item.id === id))?.id;
  const current = sectionOf(active);
  const item = (it, compact) => {
    const content = compact ? <span className="side-mini-icon">{it.label.slice(0, 1)}</span> : <><span className="side-dot" aria-hidden="true" /><span className="side-sub-label">{it.label}</span>{(it.id === 'comanda' || it.external) && <span className="side-external" aria-label="(se abre en otra pestaña)">↗</span>}</>;
    const className = `${compact ? 'side-mini' : 'side-sub'}${active === it.id ? ' active' : ''}`;
    return it.id === 'comanda' || it.external
      ? <a key={it.id} href={it.path} target="_blank" rel="noopener noreferrer" title={compact ? it.label : undefined} className={className}>{content}</a>
      : <button key={it.id} type="button" title={compact ? it.label : undefined} className={className} aria-current={active === it.id ? 'page' : undefined} onClick={() => setActive(it.id)}>{content}</button>;
  };
  return <aside className={`sidebar side ${collapsed ? 'collapsed' : ''}`}>
    <div className="sidebar-top"><div className="brand"><span className="brand-mark small">R</span>{!collapsed && <span>Restaurante<span className="brand-dot">.</span></span>}</div><button className="icon-button collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label={collapsed ? 'Expandir menú' : 'Contraer menú'}>{collapsed ? '›' : '‹'}</button></div>
    <nav className="side-nav" aria-label="Menú principal">{collapsed
      // Contraído: solo íconos, agrupados por sección con un separador.
      ? menu.map(section => <div className="side-mini-group" key={section.id} title={section.label}>{section.items.map(it => item(it, true))}</div>)
      : menu.map(section => {
        const open = openId === section.id;
        return <div className={`side-section${open ? ' open' : ''}${current === section.id ? ' current' : ''}`} key={section.id}>
          <button type="button" className="side-head" aria-expanded={open} aria-controls={`side-${section.id}`} onClick={() => setOpenId(open ? null : section.id)}>
            <span className="side-icon"><SectionIcon id={section.id} /></span>
            <span className="side-label">{section.label}</span>
            <span className="side-count" aria-hidden="true">{section.items.length}</span>
            <Chevron />
          </button>
          <div className="side-panel" id={`side-${section.id}`} inert={open ? undefined : ''}>
            <div className="side-panel-inner"><div className="side-list">{section.items.map(it => item(it, false))}</div></div>
          </div>
        </div>;
      })}</nav>
    <div className="sidebar-user"><div className="avatar">{user.nombre.slice(0, 1)}</div>{!collapsed && <div className="user-copy"><strong>{user.nombre}</strong><span>{user.rol}</span></div>}{!collapsed && <button className="logout" onClick={onLogout}>Salir</button>}</div>
  </aside>;
}
