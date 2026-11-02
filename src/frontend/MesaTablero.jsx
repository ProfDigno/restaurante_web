import { useMemo, useState } from 'react';
import { formatMoney } from './formatters.js';
import './mesa-tablero.css';

const openedAt = value => new Date(value).toLocaleString('es-PY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export default function MesaTablero({ tables, loading, error, busy, onRefresh, onOpen, onViewAccount }) {
  const [selected, setSelected] = useState('all');
  const locations = useMemo(() => {
    const byId = new Map();
    tables.forEach(table => {
      const entry = byId.get(table.fk_idubicacion_mesa) || { id: table.fk_idubicacion_mesa, name: table.ubicacion || 'Salón', count: 0 };
      entry.count += 1;
      byId.set(table.fk_idubicacion_mesa, entry);
    });
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [tables]);
  const activeFilter = selected === 'all' || locations.some(location => location.id === selected) ? selected : 'all';
  const visible = activeFilter === 'all' ? tables : tables.filter(table => table.fk_idubicacion_mesa === activeFilter);
  if (loading && !tables.length) return <div className="empty-state"><div className="loader" />Cargando mesas…</div>;
  if (error && !tables.length) return <div className="alert error">{error}</div>;
  const free = tables.filter(table => table.estado === 'libre').length;
  const occupied = tables.filter(table => table.estado === 'ocupado').length;
  return <div className="mesa-board">
    <header className="mesa-board-head">
      <div>
        <p className="eyebrow">SALÓN</p>
        <h2>Estado del salón</h2>
        <p className="mesa-board-hint">Abrí una cuenta cuando llegue el primer cliente y acumulá sus pedidos.</p>
      </div>
      <p className="mesa-counters" aria-label="Resumen de mesas">
        <span title="Capacidad configurada">Mesas <strong>{tables.length}</strong></span>
        <span className="free" title="Listas para recibir">Disponibles <strong>{free}</strong></span>
        <span className="busy" title="Con cuenta abierta">Ocupadas <strong>{occupied}</strong></span>
      </p>
      <button type="button" className="secondary" onClick={onRefresh}>Actualizar</button>
    </header>
    {error && <div className="alert error">{error}</div>}
    {locations.length > 1 && <div className="mesa-filter" role="group" aria-label="Filtrar por ubicación">
      <button type="button" className={activeFilter === 'all' ? 'active' : ''} aria-pressed={activeFilter === 'all'} onClick={() => setSelected('all')}>Todas ({tables.length})</button>
      {locations.map(location => <button type="button" key={location.id} className={activeFilter === location.id ? 'active' : ''} aria-pressed={activeFilter === location.id} onClick={() => setSelected(location.id)}>{location.name} ({location.count})</button>)}
    </div>}
    <div className="mesa-grid">
      {visible.map(table => {
        const isFree = table.estado === 'libre';
        return <article className={`mesa-card ${table.estado}`} key={table.idmesa}>
          <div className="mesa-card-head"><strong>Mesa {table.numero}</strong><span className={`pill ${table.estado}`}>{isFree ? 'Libre' : 'Ocupada'}</span></div>
          <p className="mesa-card-place">{table.ubicacion || 'Salón'} · {table.capacidad} personas</p>
          {!isFree && <div className="mesa-card-info">
            <strong className="mesa-card-total">{formatMoney(table.total)}</strong>
            {table.cliente_nombre && <>
              <span className="mesa-card-client" title={table.cliente_nombre}>{table.cliente_nombre}</span>
              <small title={`${table.cliente_ruc || 'Sin RUC'} · ${table.cliente_telefono || 'Sin teléfono'}`}>{table.cliente_ruc || 'Sin RUC'} · {table.cliente_telefono || 'Sin teléfono'}</small>
            </>}
            {table.fecha_apertura && <small title={new Date(table.fecha_apertura).toLocaleString('es-PY')}>Abierta {openedAt(table.fecha_apertura)}</small>}
          </div>}
          {isFree
            ? <button type="button" disabled={busy === table.idmesa} className="primary full" onClick={() => onOpen(table.idmesa)}>{busy === table.idmesa ? 'Abriendo…' : 'Abrir cuenta'}</button>
            : <button type="button" className="outline full" onClick={() => onViewAccount(table.idcuenta)}>Ver cuenta / Pedidos</button>}
        </article>;
      })}
    </div>
  </div>;
}
