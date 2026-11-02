import { useEffect, useState } from 'react';
import { api } from './pedidos-api.js';
import './factura.css';

const json = body => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function DatosRestaurante() {
  const [form, setForm] = useState(null);
  const [apiKeySet, setApiKeySet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = data => { const { sisfe_api_key_configurada, ...rest } = data; setApiKeySet(sisfe_api_key_configurada); setForm({ ...rest, sisfe_api_key: '' }); };
  useEffect(() => { api('/api/datos-restaurante').then(load).catch(cause => setError(cause.message)); }, []);

  const set = name => event => { setNotice(''); setForm(current => ({ ...current, [name]: event.target.value })); };
  const save = async test => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      load(await api('/api/datos-restaurante', json(form)));
      if (test) {
        const result = await api('/api/datos-restaurante/probar-conexion', { method: 'POST' });
        setNotice(`Datos guardados. ${result.mensaje || 'Conectado con SISFE'}${result.ambiente ? ` · Ambiente: ${result.ambiente}` : ''}${result.numero_factura ? ` · Próxima factura: ${result.numero_factura}` : ''}`);
      } else setNotice('Datos guardados');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };

  if (!form) return error ? <div className="alert error" role="alert">{error}</div> : <p className="muted">Cargando…</p>;
  return <form className="invoice-page" onSubmit={event => { event.preventDefault(); save(false); }}>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Datos de la empresa</h3></div>
      <div className="invoice-grid">
        <label>Razón social<input value={form.razon_social} maxLength={150} onChange={set('razon_social')} /></label>
        <label>Nombre de fantasía<input value={form.nombre_fantasia} maxLength={150} onChange={set('nombre_fantasia')} /></label>
        <label>RUC<input value={form.ruc} maxLength={11} placeholder="80012345-1" onChange={set('ruc')} /></label>
        <label>Timbrado<input value={form.timbrado} maxLength={20} onChange={set('timbrado')} /></label>
        <label>Dirección<input value={form.direccion} maxLength={250} onChange={set('direccion')} /></label>
        <label>Ciudad<input value={form.ciudad} maxLength={100} onChange={set('ciudad')} /></label>
        <label>Teléfono<input value={form.telefono} maxLength={40} onChange={set('telefono')} /></label>
        <label>Correo<input type="email" value={form.email} maxLength={150} onChange={set('email')} /></label>
      </div>
    </section>

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Numeración de facturas</h3></div>
      <div className="invoice-grid">
        <label>Establecimiento<input value={form.establecimiento} maxLength={3} inputMode="numeric" onChange={set('establecimiento')} /></label>
        <label>Punto de expedición<input value={form.punto} maxLength={3} inputMode="numeric" onChange={set('punto')} /></label>
        <label>Último número emitido<input value={form.numero_actual} inputMode="numeric" onChange={set('numero_actual')} /></label>
      </div>
      <p className="muted">La próxima factura será {form.establecimiento}-{form.punto}-{String(Number(form.numero_actual || 0) + 1).padStart(7, '0')}. El número se controla desde el sistema; SISFE rechaza los repetidos.</p>
    </section>

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Conexión con SISFE</h3></div>
      <div className="invoice-grid">
        <label>URL del servidor<input value={form.sisfe_url} maxLength={250} placeholder="https://dominio.sisfe.com.py" onChange={set('sisfe_url')} /></label>
        <label>Tenant<input value={form.sisfe_tenant} maxLength={100} onChange={set('sisfe_tenant')} /></label>
        <label>API Key<input type="password" autoComplete="new-password" value={form.sisfe_api_key} placeholder={apiKeySet ? 'Guardada · escribí una nueva para cambiarla' : 'Pegá la API Key'} onChange={set('sisfe_api_key')} /></label>
        <label>Ambiente<select value={form.ambiente} onChange={set('ambiente')}><option value="prueba">Prueba</option><option value="produccion">Producción</option></select></label>
      </div>
      <p className="muted">La API se consulta en {form.sisfe_url ? `${form.sisfe_url.replace(/\/+$/, '')}/api/${form.sisfe_tenant || '<tenant>'}` : 'URL/api/<tenant>'}. La API Key se guarda solo en el servidor.</p>
    </section>

    <div className="invoice-actions">
      <button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => save(true)}>Guardar y probar conexión</button>
    </div>
  </form>;
}
