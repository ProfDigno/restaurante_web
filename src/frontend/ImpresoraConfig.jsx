import { useEffect, useState } from 'react';
import { api } from './pedidos-api.js';
import { AGENTE_URL, detectarTerminal, imprimirEnAgente, urlConTerminal, useTerminal } from './terminal.js';
import './factura.css';
import './comanda-config.css';

const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const fecha = value => value ? new Date(value).toLocaleString('es-PY', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const SIN_COMANDA = 'El servidor todavía no tiene el ticket de comanda: hay que reiniciarlo. La opción no se guardó.';
const fila = t => ({ ...t, nombre_impresora: t.nombre_impresora || '', impresora_factura: t.impresora_factura || '', saltos_final: String(t.saltos_final) });

function EstaPc({ setError, setNotice }) {
  const { listo, agente, terminal } = useTerminal();
  const [busy, setBusy] = useState(false);
  const probar = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await imprimirEnAgente(`/api/impresora-config/prueba.pdf?pc=${encodeURIComponent(terminal?.nombre || agente.equipo)}`, 'Prueba de impresión');
      setNotice(`Prueba enviada a ${terminal?.nombre_impresora || agente.impresoraPorDefecto || agente.predeterminadaWindows || 'la impresora por defecto'}.`);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  const probarFactura = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await imprimirEnAgente('/api/impresora-config/prueba-factura.pdf', 'Prueba de factura', terminal.impresora_factura);
      setNotice(`Hoja de prueba de factura enviada a ${terminal.impresora_factura}. Ponela sobre una hoja pre-impresa para comparar.`);
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  const cambiarComanda = async event => {
    const activar = event.target.checked;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await api(`/api/terminales/${terminal.idterminal}`, json('PUT', { ...terminal, imprime_comanda: activar }));
      if (saved.imprime_comanda !== activar) throw new Error(SIN_COMANDA);
      await detectarTerminal(true);
      setNotice(activar ? 'Listo: esta PC imprime la comanda detrás de cada pedido.' : 'Esta PC ya no imprime la comanda.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  return <section className="invoice-card">
    <div className="invoice-card-head"><h3>Esta PC</h3><button type="button" className="secondary" onClick={() => detectarTerminal(true)}>Detectar de nuevo</button></div>
    {!listo ? <p className="muted">Buscando el agente de impresión…</p> : !agente ? <>
      <div className="alert info" role="status">Esta PC no tiene el agente de impresión (o no está abierto): los tickets se abren en el navegador.</div>
      <p className="muted">Descargá el agente, descomprimí el ZIP y ejecutá <strong>instalar.bat</strong>. Necesita Java 8 o superior. Después tocá <em>Detectar de nuevo</em>.</p>
    </> : <>
      <div className="invoice-grid">
        <p><strong>PC:</strong> {agente.equipo}{terminal?.nombre && terminal.nombre !== agente.equipo ? ` (${terminal.nombre})` : ''}</p>
        <p><strong>Impresora de tickets:</strong> {terminal?.nombre_impresora || <span className="muted">ninguna — asignala abajo en Terminales</span>}</p>
        <p><strong>Impresora de factura:</strong> {terminal?.impresora_factura || <span className="muted">ninguna — la factura se abre en el navegador</span>}</p>
        <p><strong>Agente:</strong> v{agente.version} · Java {agente.java}</p>
        <p><strong>Cola:</strong> {agente.cola.pendientes} pendientes · {agente.cola.errores} con error</p>
      </div>
      {terminal && (terminal.imprime_comanda === undefined
        ? <div className="alert error" role="alert">{SIN_COMANDA}</div>
        : <label className="check-label"><input type="checkbox" checked={terminal.imprime_comanda} disabled={busy} onChange={cambiarComanda} /> En esta PC: imprimir comanda detrás del pedido (se guarda al marcar)</label>)}
      {terminal && !terminal.activo && <div className="alert info" role="status">Esta terminal está desactivada: los tickets se abren en el navegador.</div>}
    </>}
    <div className="invoice-actions">
      <a className="secondary ticket-link" href="/api/impresora-config/agente.zip" download>Descargar agente de impresión</a>
      {agente && <a className="secondary ticket-link" href={`${AGENTE_URL}/`} target="_blank" rel="noopener noreferrer">Abrir panel del agente</a>}
      <a className="secondary ticket-link" href={urlConTerminal(`/api/impresora-config/prueba.pdf?pc=${encodeURIComponent(terminal?.nombre || agente?.equipo || '')}`)} target="_blank" rel="noopener noreferrer">Ver PDF de prueba</a>
      <a className="secondary ticket-link" href="/api/impresora-config/prueba-factura.pdf" target="_blank" rel="noopener noreferrer">Ver prueba de factura</a>
      {agente && terminal?.activo && terminal?.impresora_factura && <button type="button" className="secondary" disabled={busy} onClick={probarFactura}>{busy ? 'Enviando…' : 'Imprimir prueba de factura'}</button>}
      {agente && <button type="button" className="primary" disabled={busy} onClick={probar}>{busy ? 'Enviando…' : 'Imprimir prueba'}</button>}
    </div>
  </section>;
}

function Terminales({ setError, setNotice }) {
  const [items, setItems] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const actual = useTerminal().terminal;
  const cargar = () => api('/api/terminales').then(rows => setItems(rows.map(fila))).catch(cause => setError(cause.message));
  useEffect(() => { cargar(); }, [actual?.idterminal]);
  // Lo marcado en "Esta PC" se refleja en su fila sin perder lo que se esté editando.
  useEffect(() => {
    if (actual) setItems(list => list?.map(t => t.idterminal === actual.idterminal ? { ...t, imprime_comanda: actual.imprime_comanda } : t) ?? list);
  }, [actual?.idterminal, actual?.imprime_comanda]);

  const cambiar = (id, patch) => { setNotice(''); setItems(list => list.map(t => t.idterminal === id ? { ...t, ...patch, sucio: true } : t)); };
  const guardar = async t => {
    setSavingId(t.idterminal); setError(''); setNotice('');
    try {
      const saved = await api(`/api/terminales/${t.idterminal}`, json('PUT', { ...t, saltos_final: t.saltos_final === '' ? '' : Number(t.saltos_final) }));
      setItems(list => list.map(x => x.idterminal === saved.idterminal ? fila(saved) : x));
      if (saved.idterminal === actual?.idterminal) await detectarTerminal(true);
      if (t.imprime_comanda !== undefined && saved.imprime_comanda === undefined) throw new Error(SIN_COMANDA);
      setNotice(`Terminal "${saved.nombre}" guardada.`);
    } catch (cause) { setError(cause.message); } finally { setSavingId(null); }
  };

  return <section className="invoice-card">
    <div className="invoice-card-head"><h3>Terminales (PCs)</h3><button type="button" className="secondary" onClick={cargar}>Actualizar</button></div>
    <p className="muted">Cada PC con el agente de impresión aparece sola al entrar al sistema. Asigná a cada una su impresora de tickets (papel y saltos finales), la impresora de factura (hoja pre-impresa con el triplicado) y marcá Comanda si tiene que imprimirla detrás de cada pedido.</p>
    {!items ? <p className="muted">Cargando…</p> : !items.length ? <p className="muted">Todavía no se registró ninguna PC. Instalá el agente en una PC y entrá al sistema desde ella.</p> :
      <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>PC</th><th>Impresora de tickets</th><th>Impresora de factura</th><th>Papel</th><th>Saltos</th><th>Comanda</th><th>Activa</th><th>Última conexión</th><th /></tr></thead><tbody>
        {items.map(t => {
          const impresoras = [...new Set([...(t.impresoras_detectadas || []), t.nombre_impresora].filter(Boolean))];
          const impresorasFactura = [...new Set([...(t.impresoras_detectadas || []), t.impresora_factura].filter(Boolean))];
          return <tr key={t.idterminal} className={t.activo ? '' : 'inactive-row'}>
            <td><input aria-label={`Nombre de la PC ${t.equipo}`} value={t.nombre} maxLength={60} onChange={e => cambiar(t.idterminal, { nombre: e.target.value })} /><small>{t.equipo}{t.idterminal === actual?.idterminal ? ' · esta PC' : ''}</small></td>
            <td><select aria-label={`Impresora de ${t.nombre}`} value={t.nombre_impresora} onChange={e => cambiar(t.idterminal, { nombre_impresora: e.target.value })}>
              <option value="">Ninguna (navegador)</option>
              {impresoras.map(n => <option key={n} value={n}>{n}{(t.impresoras_detectadas || []).includes(n) ? '' : ' (no detectada)'}</option>)}
            </select></td>
            <td><select aria-label={`Impresora de factura de ${t.nombre}`} value={t.impresora_factura} onChange={e => cambiar(t.idterminal, { impresora_factura: e.target.value })}>
              <option value="">Ninguna (navegador)</option>
              {impresorasFactura.map(n => <option key={n} value={n}>{n}{(t.impresoras_detectadas || []).includes(n) ? '' : ' (no detectada)'}</option>)}
            </select></td>
            <td><select aria-label={`Papel de ${t.nombre}`} value={t.tamano_ticket} onChange={e => cambiar(t.idterminal, { tamano_ticket: Number(e.target.value) })}><option value={80}>80 mm (74 a 80)</option><option value={58}>58 mm</option></select></td>
            <td><input aria-label={`Saltos finales de ${t.nombre}`} type="number" min="0" max="30" style={{ width: 70 }} value={t.saltos_final} onChange={e => cambiar(t.idterminal, { saltos_final: e.target.value })} /></td>
            <td><input aria-label={`Imprimir comanda en ${t.nombre}`} title="Imprimir comanda detrás del pedido" type="checkbox" checked={Boolean(t.imprime_comanda)} onChange={e => cambiar(t.idterminal, { imprime_comanda: e.target.checked })} /></td>
            <td><input aria-label={`${t.nombre} activa`} type="checkbox" checked={t.activo} onChange={e => cambiar(t.idterminal, { activo: e.target.checked })} /></td>
            <td>{fecha(t.ultima_conexion)}<small>{t.ultimo_usuario || ''}{t.version_agente ? ` · agente v${t.version_agente}` : ''}</small></td>
            <td><button type="button" className={t.sucio ? 'primary' : 'secondary'} disabled={savingId === t.idterminal || !t.sucio} onClick={() => guardar(t)}>{savingId === t.idterminal ? 'Guardando…' : 'Guardar'}</button></td>
          </tr>;
        })}
      </tbody></table></div>}
  </section>;
}

const formDefecto = d => ({ tamano_ticket: d.tamano_ticket, saltos_final: String(d.saltos_final), imprime_comanda: d.imprime_comanda === true });

function Defecto({ setError, setNotice }) {
  const { agente, terminal } = useTerminal();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/impresora-config').then(d => setForm(formDefecto(d))).catch(cause => setError(cause.message)); }, []);
  const save = async event => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const d = await api('/api/impresora-config', json('PUT', { ...form, saltos_final: form.saltos_final === '' ? '' : Number(form.saltos_final) }));
      setForm(formDefecto(d));
      if (d.imprime_comanda === undefined) throw new Error(SIN_COMANDA);
      setNotice(agente && terminal?.activo && d.imprime_comanda !== terminal.imprime_comanda
        ? 'Valores por defecto guardados. Esta PC tiene su propia opción de comanda: cambiala arriba, en "Esta PC".'
        : 'Valores por defecto guardados.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };
  if (!form) return null;
  return <form className="invoice-card" onSubmit={save}>
    <div className="invoice-card-head"><h3>Valores por defecto</h3></div>
    <p className="muted">Se usan en las PCs sin agente de impresión y como valor inicial de cada PC nueva. No cambian las PCs que ya están en Terminales.</p>
    <div className="invoice-grid">
      <label>Tamaño del ticket<select value={form.tamano_ticket} onChange={e => setForm({ ...form, tamano_ticket: Number(e.target.value) })}><option value={80}>80 mm · rollos de 74 a 80 (imprime 72 mm)</option><option value={58}>58 mm · rollo angosto (imprime 48 mm)</option></select></label>
      <label>Saltos de línea al final<input type="number" min="0" max="30" required value={form.saltos_final} onChange={e => setForm({ ...form, saltos_final: e.target.value })} /><small className="muted">Espacio en blanco antes del corte (1 salto ≈ 4 mm).</small></label>
    </div>
    <label className="check-label"><input type="checkbox" checked={form.imprime_comanda} onChange={e => setForm({ ...form, imprime_comanda: e.target.checked })} /> Por defecto: imprimir comanda detrás del pedido</label>
    <p className="muted">La comanda sale sin precios, con los productos de cocina y el total de cada insumo. Desde el navegador, el corte entre los dos tickets necesita que el driver de la impresora corte por página.</p>
    <div className="invoice-actions"><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
  </form>;
}

export default function ImpresoraConfig() {
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const props = { setError, setNotice };
  return <div className="invoice-page">
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    <EstaPc {...props} />
    <Terminales {...props} />
    <Defecto {...props} />
  </div>;
}
