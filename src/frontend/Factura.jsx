import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { api, mutate } from './pedidos-api.js';
import { formatMoney } from './formatters.js';
import './factura.css';

const dateTime = value => value ? new Date(value).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const ESTADOS = { pendiente: 'Pendiente', borrador: 'Borrador', enviado: 'Enviada', aprobado: 'Aprobada', rechazado: 'Rechazada', cancelado: 'Cancelada', error: 'Con error' };
const emptyClient = { fk_idcliente: null, ruc: '', razon_social: '', direccion: '', email: '', celular: '' };

const Estado = ({ value }) => <span className={`invoice-state invoice-state-${value}`}>{ESTADOS[value] || value}</span>;

function clientFrom(factura) {
  return {
    fk_idcliente: factura.fk_idcliente, ruc: factura.cliente_ruc || '', razon_social: factura.contribuyente ? factura.cliente_razon_social : '',
    direccion: factura.cliente_direccion || '', email: factura.cliente_email || '', celular: factura.cliente_celular || ''
  };
}

function ClientePicker({ onPick, onClose }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api(`/api/facturas/clientes?${new URLSearchParams({ search })}`).then(result => { if (live) setItems(result.items); }).catch(cause => { if (live) setError(cause.message); });
    }, 200);
    return () => { live = false; clearTimeout(timer); };
  }, [search]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal invoice-picker" role="dialog" aria-modal="true" aria-label="Cambiar cliente">
      <div className="modal-head"><h2>Cambiar cliente</h2><button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">×</button></div>
      <input autoFocus type="search" placeholder="Buscar por nombre, RUC o teléfono…" value={search} onChange={event => setSearch(event.target.value)} />
      {error && <div className="alert error" role="alert">{error}</div>}
      <ul className="invoice-picker-list">
        {items.map(item => <li key={item.idcliente}><button type="button" onClick={() => onPick({
          fk_idcliente: item.idcliente, ruc: item.ruc || '', razon_social: item.razon_social || item.nombre_completo,
          direccion: item.direccion || '', email: item.email || '', celular: item.telefono || ''
        })}><strong>{item.nombre_completo}</strong><small>{item.ruc ? `RUC ${item.ruc}` : 'Sin RUC'}{item.telefono ? ` · ${item.telefono}` : ''}</small></button></li>)}
        {!items.length && <li className="muted">Sin resultados</li>}
      </ul>
    </div>
  </div>;
}

function FacturaForm({ pedidoId, facturaId, onBack }) {
  const [factura, setFactura] = useState(null);
  const [borrador, setBorrador] = useState(null);
  const [cliente, setCliente] = useState(emptyClient);
  const [ruc, setRuc] = useState(null);
  const [picker, setPicker] = useState(false);
  const [cancel, setCancel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const show = data => { setFactura(data); setBorrador(null); setCliente(clientFrom(data)); };
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    const load = facturaId
      ? api(`/api/facturas/${facturaId}`).then(data => { if (live) show(data); })
      : api(`/api/facturas/desde-pedido/${pedidoId}`).then(data => {
        if (!live) return;
        if (data.existente) show(data.factura); else { setFactura(null); setBorrador(data.borrador); setCliente(data.borrador.cliente); }
      });
    load.catch(cause => { if (live) setError(cause.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [pedidoId, facturaId]);

  const run = async action => {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); return true; } catch (cause) {
      setError(cause.message);
      // Si SISFE falló, la factura ya quedó guardada: se vuelve a cargar para mostrar su estado.
      const id = factura?.idfactura;
      if (id) api(`/api/facturas/${id}`).then(show).catch(() => {});
      else if (pedidoId) api(`/api/facturas/desde-pedido/${pedidoId}`).then(data => { if (data.existente) show(data.factura); }).catch(() => {});
      return false;
    } finally { setBusy(false); }
  };

  const editable = !factura;
  const setField = (name, value) => setCliente(current => ({ ...current, [name]: value }));
  const verifyRuc = () => run(async () => {
    setRuc(null);
    if (!cliente.ruc.trim()) throw new Error('Ingresá el RUC a verificar');
    setRuc(await api(`/api/facturas/ruc/${encodeURIComponent(cliente.ruc.trim())}`));
  });
  const save = () => run(async () => {
    const data = await mutate('/api/facturas', { fk_idpedido: pedidoId, cliente });
    show(data);
  });
  const post = (path, body) => run(async () => show(await mutate(`/api/facturas/${factura.idfactura}/${path}`, body)));

  if (loading) return <p className="muted">Cargando…</p>;
  const source = factura || borrador;
  if (!source) return <div><button type="button" className="secondary" onClick={onBack}>Volver</button>{error && <div className="alert error" role="alert">{error}</div>}</div>;
  const detalles = source.detalles;
  const hasDiscount = detalles.some(line => Number(line.descuento) > 0);
  const total = Number(source.total);
  const iva = Number(source.total_iva10);
  const aprobada = factura?.estado === 'aprobado';

  return <div className="invoice-page">
    <div className="invoice-heading">
      <div>
        <button type="button" className="secondary" onClick={onBack}>← Facturas</button>
        <h2>{factura ? `Factura ${factura.numero_completo}` : 'Nueva factura electrónica'}</h2>
        <p className="muted">Pedido #{factura ? factura.fk_idpedido : borrador.pedido.idpedido}{borrador?.pedido.numero_mesa ? ` · Mesa ${borrador.pedido.numero_mesa}` : ''}{factura ? ` · ${dateTime(factura.fecha_emision)}` : ''}</p>
      </div>
      {factura && <Estado value={factura.estado} />}
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    {factura?.respuesta_mensaje && <div className={`alert ${factura.estado === 'error' || factura.estado === 'rechazado' ? 'error' : 'info'}`}>{factura.respuesta_codigo ? `${factura.respuesta_codigo} · ` : ''}{factura.respuesta_mensaje}</div>}
    {borrador && !borrador.cuadra && <div className="alert error" role="alert">El total de la factura ({formatMoney(borrador.total)}) no coincide con el del pedido ({formatMoney(borrador.pedido.monto_total)}). No se puede emitir.</div>}

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Cliente</h3>{editable && <button type="button" className="secondary" onClick={() => setPicker(true)}>Cambiar cliente</button>}</div>
      <div className="invoice-grid">
        <label>RUC<span className="invoice-ruc"><input value={cliente.ruc} disabled={!editable} maxLength={11} placeholder="Sin RUC: consumidor final" onChange={event => { setField('ruc', event.target.value); setRuc(null); }} />{editable && <button type="button" className="secondary" disabled={busy || !cliente.ruc.trim()} onClick={verifyRuc}>Verificar RUC</button>}</span></label>
        <label>Razón social / nombre<input value={cliente.ruc ? cliente.razon_social : 'Sin Nombre'} disabled={!editable || !cliente.ruc} maxLength={150} onChange={event => setField('razon_social', event.target.value)} /></label>
        <label>Dirección<input value={cliente.direccion} disabled={!editable} maxLength={250} onChange={event => setField('direccion', event.target.value)} /></label>
        <label>Correo<input type="email" value={cliente.email} disabled={!editable} maxLength={150} onChange={event => setField('email', event.target.value)} /></label>
        <label>Celular<input value={cliente.celular} disabled={!editable} maxLength={40} onChange={event => setField('celular', event.target.value)} /></label>
      </div>
      {!cliente.ruc && <p className="muted">Sin RUC se emite como innominado (consumidor final), con el nombre «Sin Nombre».</p>}
      {ruc && <div className={`alert ${ruc.encontrado && ruc.activo ? 'success' : 'error'}`} role="status">
        {ruc.encontrado
          ? <>RUC encontrado: <strong>{ruc.razon_social}</strong> · {ruc.estado}{ruc.activo ? '' : ' (no se puede facturar a un RUC inactivo)'}
            {ruc.razon_social && ruc.razon_social !== cliente.razon_social && <> <button type="button" className="secondary" onClick={() => setCliente(current => ({ ...current, ruc: ruc.ruc_completo || current.ruc, razon_social: ruc.razon_social }))}>Usar esta razón social</button></>}</>
          : ruc.mensaje}
      </div>}
    </section>

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Detalle</h3><span className="invoice-tags"><span>Contado</span><span>Efectivo</span><span>IVA 10%</span></span></div>
      <div className="catalog-table-wrap"><table className="catalog-table invoice-table"><thead><tr><th>Descripción</th><th className="numeric-cell">Cant.</th><th className="numeric-cell">Precio</th>{hasDiscount && <th className="numeric-cell">Desc.</th>}<th className="numeric-cell">Subtotal</th></tr></thead><tbody>
        {detalles.map((line, index) => <tr key={line.idfactura_detalle || index}><td>{line.descripcion}</td><td className="numeric-cell">{Number(line.cantidad)}</td><td className="numeric-cell">{formatMoney(line.precio_unitario)}</td>{hasDiscount && <td className="numeric-cell">{Number(line.descuento) ? formatMoney(line.descuento) : '—'}</td>}<td className="numeric-cell">{formatMoney(line.subtotal)}</td></tr>)}
      </tbody></table></div>
      <dl className="invoice-totals"><div><dt>Gravado 10%</dt><dd>{formatMoney(total - iva)}</dd></div><div><dt>IVA 10%</dt><dd>{formatMoney(iva)}</dd></div><div className="invoice-total"><dt>Total</dt><dd>{formatMoney(total)}</dd></div></dl>
    </section>

    {factura?.cdc && <p className="muted invoice-cdc">CDC: {factura.cdc}</p>}
    <div className="invoice-actions">
      {editable && <button type="button" className="primary" disabled={busy || !borrador.cuadra} onClick={save}>{busy ? 'Guardando…' : 'Guardar factura (borrador)'}</button>}
      {factura?.estado === 'error' && <button type="button" className="primary" disabled={busy} onClick={() => post('reintentar')}>{busy ? 'Enviando…' : 'Reintentar'}</button>}
      {factura?.estado === 'borrador' && <button type="button" className="primary" disabled={busy} onClick={() => post('confirmar')}>{busy ? 'Enviando a SIFEN…' : 'Confirmar y enviar a SIFEN'}</button>}
      {factura?.cdc && <a className="secondary" href={`/api/facturas/${factura.idfactura}/kude.pdf`} target="_blank" rel="noopener noreferrer">Imprimir KUDE</a>}
      {factura?.cdc && factura.estado !== 'cancelado' && <button type="button" className="secondary" disabled={busy} onClick={() => post('estado')}>Actualizar estado</button>}
      {aprobada && <button type="button" className="secondary danger-text" disabled={busy} onClick={() => setCancel('')}>Cancelar factura</button>}
    </div>

    {picker && <ClientePicker onClose={() => setPicker(false)} onPick={item => { setCliente(item); setRuc(null); setPicker(false); }} />}
    {cancel !== null && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="Cancelar factura">
      <div className="modal-head"><h2>Cancelar factura</h2><button type="button" className="modal-close" disabled={busy} onClick={() => setCancel(null)}>×</button></div>
      <form className="modal-form" onSubmit={event => { event.preventDefault(); post('cancelar', { motivo: cancel }).then(done => { if (done) setCancel(null); }); }}>
        <p>Se cancela la factura {factura.numero_completo} en SIFEN. Solo se puede dentro de las 48 horas de emitida.</p>
        <label>Motivo<textarea required minLength={5} maxLength={500} value={cancel} onChange={event => setCancel(event.target.value)} /></label>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="secondary" disabled={busy} onClick={() => setCancel(null)}>Volver</button><button className="primary" disabled={busy}>{busy ? 'Cancelando…' : 'Cancelar factura'}</button></div>
      </form>
    </div></div>}
  </div>;
}

function FacturaLista({ onOpen }) {
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [search, setSearch] = useState('');
  const [estado, setEstado] = useState('');
  const [inicio, setInicio] = useState('');
  const [fin, setFin] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    api(`/api/facturas?${new URLSearchParams({ search, estado, inicio, fin, page, pageSize: 25 })}`)
      .then(result => { if (live) setData(result); })
      .catch(cause => { if (live) setError(cause.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [search, estado, inicio, fin, page]);

  const filter = setter => event => { setter(event.target.value); setPage(1); };
  return <div className="catalog-page">
    <TopbarSlot>
      <div className="search-box"><span>⌕</span><input placeholder="Cliente, RUC o número…" value={search} onChange={filter(setSearch)} /></div>
      <label>Desde<input type="date" value={inicio} onChange={filter(setInicio)} /></label>
      <label>Hasta<input type="date" value={fin} onChange={filter(setFin)} /></label>
      <label>Estado<select value={estado} onChange={filter(setEstado)}><option value="">Todos</option>{Object.entries(ESTADOS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </TopbarSlot>
    <TopbarSlot name="sub"><span>{data.total} facturas · se emiten desde el botón Facturar de un pedido</span></TopbarSlot>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>Fecha</th><th>Número</th><th>Cliente</th><th className="numeric-cell">Total</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {loading ? <tr><td colSpan="6" className="table-loading">Cargando…</td></tr> : !data.items.length ? <tr><td colSpan="6" className="table-empty">Sin facturas para estos filtros</td></tr>
        : data.items.map(item => <tr key={item.idfactura}>
          <td>{dateTime(item.fecha_emision)}</td>
          <td><strong>{item.numero_completo}</strong><small>Pedido #{item.fk_idpedido}</small></td>
          <td>{item.cliente_razon_social}<small>{item.cliente_ruc ? `RUC ${item.cliente_ruc}` : 'Sin RUC'}</small></td>
          <td className="numeric-cell"><strong>{formatMoney(item.total)}</strong></td>
          <td><Estado value={item.estado} /></td>
          <td><div className="invoice-row-actions"><button type="button" className="edit-button" onClick={() => onOpen(item.idfactura)}>Ver</button>{item.cdc && <a className="edit-button" href={`/api/facturas/${item.idfactura}/kude.pdf`} target="_blank" rel="noopener noreferrer">Imprimir</a>}</div></td>
        </tr>)}
    </tbody></table></div>
    <div className="catalog-footer"><span>Página {page} de {data.totalPages}</span><button className="page-button" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button><button className="page-button" disabled={loading || page >= data.totalPages} onClick={() => setPage(page + 1)}>Siguiente</button></div>
  </div>;
}

// Sin pedidoId muestra el listado; con pedidoId (botón Facturar de un pedido) abre el formulario del pedido.
export default function Factura({ pedidoId = null }) {
  const [view, setView] = useState(pedidoId ? { pedidoId } : null);
  useEffect(() => { setView(pedidoId ? { pedidoId } : null); }, [pedidoId]);
  if (!view) return <FacturaLista onOpen={facturaId => setView({ facturaId })} />;
  return <FacturaForm key={view.facturaId || view.pedidoId} pedidoId={view.pedidoId} facturaId={view.facturaId} onBack={() => setView(null)} />;
}
