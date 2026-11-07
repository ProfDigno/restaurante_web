import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { api } from './pedidos-api.js';
import { ExcelIcon } from './ActionIcons.jsx';
import './rrhh.css';
import './auditoria.css';

// Auditoría: registro de solo lectura de las acciones sensibles (anulaciones, precios, descuentos, caja, usuarios).
const dateTime = value => value ? new Date(value).toLocaleString('es-PY') : '—';
const entidades = { pedido: 'Pedido', producto: 'Producto', ingrediente: 'Ingrediente', compra: 'Compra', gasto: 'Gasto', vale: 'Vale', caja: 'Caja', factura: 'Factura', usuario: 'Usuario', rol: 'Rol', permiso: 'Permiso' };
const etiquetas = {
  precio_venta: 'Precio de venta', precio_compra: 'Precio de compra', precio_lista: 'Precio de lista', stock_actual: 'Stock',
  monto_descuento: 'Descuento', motivo_descuento: 'Motivo del descuento', monto_total: 'Total', estado_pago: 'Estado de pago',
  permisos_quitados: 'Permisos quitados', permisos_agregados: 'Permisos agregados', contrasena: 'Contraseña', tipo_entrega: 'Entrega'
};
// Estados internos con el nombre que se ve en pantalla (TERMINADO = listo, COCINA = en_preparacion).
const estados = { en_preparacion: 'En cocina', listo: 'Terminado', cancelado: 'Anulado', cancelada: 'Anulada', pagado: 'Pagado', pagada: 'Pagada',
  entregado: 'Entregado', abierto: 'Abierto', confirmado: 'Confirmado', anulado: 'Anulado', anulada: 'Anulada', pendiente: 'Pendiente',
  borrador: 'Borrador', recibida: 'Recibida', aprobado: 'Aprobado', COMER_ACA: 'Comer acá', DELIVERY: 'Delivery', BUSCAR: 'Retirar' };
const label = key => etiquetas[key] || key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ');
const show = value => value === undefined || value === null || value === '' ? '—'
  : Array.isArray(value) ? value.join(', ')
  : typeof value === 'number' ? value.toLocaleString('es-PY')
  : typeof value === 'boolean' ? (value ? 'Sí' : 'No')
  : typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${label(k)} ${show(v)}`).join(' · ')
  : estados[value] || String(value);

function Cambio({ antes, despues }) {
  const keys = [...new Set([...Object.keys(antes || {}), ...Object.keys(despues || {})])];
  if (!keys.length) return <span className="muted">—</span>;
  return <ul className="audit-changes">{keys.map(key => {
    const before = antes && key in antes, after = despues && key in despues;
    return <li key={key}><span>{label(key)}:</span>{' '}
      {before && after ? <><del>{show(antes[key])}</del> → <strong>{show(despues[key])}</strong></>
        : <strong>{show(after ? despues[key] : antes[key])}</strong>}</li>;
  })}</ul>;
}

export default function Auditoria() {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1, acciones: {}, usuarios: [] });
  const [filtro, setFiltro] = useState({ desde: '', hasta: '', usuario: '', accion: '', entidad: '', id: '' });
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const query = new URLSearchParams(Object.entries(filtro).filter(([, value]) => value !== ''));
  useEffect(() => {
    let active = true;
    setLoading(true);
    api(`/api/auditoria?${new URLSearchParams({ ...Object.fromEntries(query), page, pageSize })}`)
      .then(result => { if (active) { setData(result); setError(''); } })
      .catch(e => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query.toString(), page, pageSize]);
  const set = key => event => { setFiltro({ ...filtro, [key]: event.target.value }); setPage(1); };

  return <div className="catalog-page">
    <TopbarSlot><a className="secondary audit-export" href={`/api/auditoria/reporte.xlsx?${query}`} title="Descargar Excel con los filtros actuales"><ExcelIcon /> Excel</a></TopbarSlot>
    <TopbarSlot name="sub"><span>{data.total} registros · solo lectura</span></TopbarSlot>
    <div className="rrhh-filters">
      <label>Desde<input type="date" value={filtro.desde} onChange={set('desde')} /></label>
      <label>Hasta<input type="date" value={filtro.hasta} onChange={set('hasta')} /></label>
      <label>Usuario<select value={filtro.usuario} onChange={set('usuario')}><option value="">Todos</option>{data.usuarios.map(login => <option key={login}>{login}</option>)}</select></label>
      <label>Acción<select value={filtro.accion} onChange={set('accion')}><option value="">Todas</option>{Object.entries(data.acciones).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label>Registro<select value={filtro.entidad} onChange={set('entidad')}><option value="">Todos</option>{Object.entries(entidades).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label>N.º<input className="audit-id" type="text" inputMode="numeric" pattern="[0-9]*" placeholder="#" value={filtro.id} onChange={e => { if (/^[0-9]{0,9}$/.test(e.target.value)) set('id')(e); }} /></label>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table audit-table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Cambio</th><th>Motivo</th></tr></thead>
      <tbody>{loading && !data.items.length ? <tr><td colSpan="6">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="6" className="table-empty">Sin registros para estos filtros</td></tr> : data.items.map(item => <tr key={item.idauditoria}>
        <td>{dateTime(item.fecha)}<small>#{item.idauditoria}</small></td>
        <td><strong>{item.usuario_login}</strong>{item.ip && <small>{item.ip}</small>}</td>
        <td>{data.acciones[item.accion] || item.accion}</td>
        <td>{entidades[item.entidad] || item.entidad}{item.id_entidad ? ` #${item.id_entidad}` : ''}</td>
        <td><Cambio antes={item.antes} despues={item.despues} /></td>
        <td>{item.motivo || <span className="muted">—</span>}</td>
      </tr>)}</tbody>
    </table></div>
    <div className="catalog-footer"><label>Mostrar <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}>{[25, 50, 100].map(n => <option key={n}>{n}</option>)}</select></label><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </div>;
}
