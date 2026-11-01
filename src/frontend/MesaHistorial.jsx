import { useEffect, useState } from 'react';
import { formatMoney } from './formatters.js';
import './mesa-historial.css';

const dateTime = value => value ? new Date(value).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }) : '—';

const DetailIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2.5 12s3.5-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.5 5.5-9.5 5.5S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>;
const PrintIcon = () => <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M6 8V3h12v5M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v7H6z"/><path d="M18 11h1"/></svg>;

export default function MesaHistorial() {
  const [mesa, setMesa] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], mesas: [], total: 0, totalPages: 1 });
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ page: String(page), pageSize: '10' });
    if (mesa) params.set('mesa', mesa);
    fetch(`/api/mesas/historial?${params}`).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo cargar el historial');
      return body;
    }).then(body => { if (active) setData(body); })
      .catch(cause => { if (active) setError(cause.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mesa, page]);

  const openDetail = async cuentaId => {
    setDetailLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/mesas/historial/${cuentaId}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo cargar el detalle');
      setDetail(body);
    } catch (cause) { setError(cause.message); }
    finally { setDetailLoading(false); }
  };

  return <section className="mesa-history" aria-label="Historial de uso de mesas">
    <div className="mesa-history-heading"><div><h2>Historial de uso</h2><p className="muted">Cuentas de mesas cerradas, con sus pedidos y pagos.</p></div></div>
      <div className="mesa-history-controls"><label>Mesa <select value={mesa} onChange={event => { setMesa(event.target.value); setPage(1); }}><option value="">Todas las mesas</option>{data.mesas.map(item => <option key={item.idmesa} value={item.idmesa}>Mesa {item.numero}</option>)}</select></label><span>{data.total} usos finalizados</span></div>
      {error && <div className="alert error">{error}</div>}
      <div className="catalog-table-wrap"><table className="catalog-table mesa-history-table"><thead><tr><th>Mesa</th><th>Cliente</th><th>Inicio</th><th>Fin</th><th>Total</th><th>Acciones</th></tr></thead><tbody>
        {loading ? <tr><td colSpan="6" className="table-loading">Cargando historial…</td></tr> : data.items.length === 0 ? <tr><td colSpan="6" className="table-empty">No hay usos finalizados para mostrar.</td></tr> : data.items.map(item => <tr key={item.idcuenta}><td>Mesa {item.mesa_numero}<small>Cuenta #{item.idcuenta}</small></td><td>{item.cliente || 'Sin cliente'}</td><td>{dateTime(item.fecha_apertura)}</td><td>{dateTime(item.fecha_cierre)}</td><td>{formatMoney(item.total)}</td><td><div className="mesa-history-actions"><button type="button" className="edit-button mesa-history-icon-button" disabled={detailLoading} onClick={() => openDetail(item.idcuenta)} aria-label={`Ver detalle de la cuenta #${item.idcuenta}`} title="Ver detalle"><DetailIcon /></button><a className="edit-button mesa-history-icon-button" href={`/api/mesas/historial/${item.idcuenta}/ticket.pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Imprimir ticket de la cuenta #${item.idcuenta}`} title="Imprimir ticket"><PrintIcon /></a></div></td></tr>)}
      </tbody></table></div>
      <div className="catalog-footer"><span>Página {page} de {data.totalPages}</span><div className="pagination"><button type="button" className="page-button" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</button><button type="button" className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(value => value + 1)}>Siguiente</button></div></div>
    {detail && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(null); }}><div className="modal mesa-history-modal" role="dialog" aria-modal="true" aria-label={`Historial de mesa ${detail.mesa_numero}`}><div className="modal-head"><div><h2>Mesa {detail.mesa_numero} · Cuenta #{detail.idcuenta}</h2><p className="muted">{detail.cliente || 'Sin cliente'} · {dateTime(detail.fecha_apertura)} a {dateTime(detail.fecha_cierre)}</p></div><button type="button" className="modal-close" onClick={() => setDetail(null)} aria-label="Cerrar">×</button></div><p className="mesa-history-total">Total: <strong>{formatMoney(detail.total)}</strong></p><a className="secondary mesa-history-print" href={`/api/mesas/historial/${detail.idcuenta}/ticket.pdf`} target="_blank" rel="noopener noreferrer">Imprimir ticket</a>
      <h3>Pedidos</h3>{detail.pedidos.length ? <ul>{detail.pedidos.map(item => <li key={item.idpedido}>#{item.idpedido} · {item.cliente || 'Sin cliente'} · {item.estado} · {formatMoney(item.monto_total)}</li>)}</ul> : <p className="muted">Sin pedidos.</p>}
      <h3>Pagos</h3>{detail.pagos.length ? <ul>{detail.pagos.map(item => <li key={item.idpago}>#{item.idpago} · {item.forma_pago} · {item.estado} · {formatMoney(item.importe)}{Number(item.devuelto) > 0 ? ` · devuelto ${formatMoney(item.devuelto)}` : ''}</li>)}</ul> : <p className="muted">Sin pagos registrados.</p>}
      <h3>Devoluciones</h3>{detail.devoluciones.length ? <ul>{detail.devoluciones.map(item => <li key={item.iddevolucion_pago}>Pago #{item.fk_idpago} · Pedido #{item.fk_idpedido} · {formatMoney(item.importe)} · {item.motivo}</li>)}</ul> : <p className="muted">Sin devoluciones.</p>}
    </div></div>}
  </section>;
}
