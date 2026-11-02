import { useEffect, useState } from 'react';
import { api } from './pedidos-api.js';
import './factura.css';
import './comanda-config.css';

const put = body => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const NUMEROS = [
  ['limite_terminado_min', 'Límite máximo (minutos)', 'Pasa a TERMINADO solo cuando el pedido supera este tiempo.'],
  ['anulado_visible_seg', 'Segundos que se ve un pedido anulado', 'Se muestra parpadeando en rojo durante este tiempo.'],
  ['refresco_seg', 'Refresco de la pantalla (segundos)', 'Cada cuánto consulta pedidos nuevos.'],
  ['chequeo_limite_seg', 'Revisión del límite (segundos)', 'Cada cuánto el servidor revisa los pedidos vencidos.']
];

export default function ComandaConfig() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = data => setForm({
    limite_terminado_min: data.limite_terminado_min, pase_automatico: data.pase_automatico, anulado_visible_seg: data.anulado_visible_seg,
    refresco_seg: data.refresco_seg, chequeo_limite_seg: data.chequeo_limite_seg,
    colores: data.colores.map(({ desde_minuto, color }) => ({ desde_minuto, color }))
  });
  useEffect(() => { api('/api/comanda-config').then(load).catch(cause => setError(cause.message)); }, []);

  const change = patch => { setNotice(''); setForm(current => ({ ...current, ...patch })); };
  const setTramo = (index, patch) => change({ colores: form.colores.map((tramo, i) => i === index ? { ...tramo, ...patch } : tramo) });
  const addTramo = () => {
    const last = form.colores.reduce((max, tramo) => Math.max(max, Number(tramo.desde_minuto) || 0), 0);
    change({ colores: [...form.colores, { desde_minuto: Math.min(last + 10, 1440), color: '#ffffff' }] });
  };
  const removeTramo = index => change({ colores: form.colores.filter((_, i) => i !== index) });

  const save = async event => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      load(await api('/api/comanda-config', put({ ...form, colores: form.colores.map(tramo => ({ ...tramo, desde_minuto: Number(tramo.desde_minuto) })) })));
      setNotice('Configuración guardada. La Comanda la aplica en su próximo refresco.');
    } catch (cause) { setError(cause.message); } finally { setBusy(false); }
  };

  if (!form) return error ? <div className="alert error" role="alert">{error}</div> : <p className="muted">Cargando…</p>;
  const ordenados = [...form.colores].sort((a, b) => Number(a.desde_minuto) - Number(b.desde_minuto));
  const ultimo = ordenados.length ? Number(ordenados[ordenados.length - 1].desde_minuto) : 0;
  return <form className="invoice-page" onSubmit={save}>
    {error && <div className="alert error" role="alert">{error}</div>}
    {notice && <div className="alert success" role="status">{notice}</div>}

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Colores por tiempo</h3><button type="button" className="secondary" onClick={addTramo} disabled={form.colores.length >= 20}>+ Agregar tramo</button></div>
      <p className="muted">La tarjeta toma el color del último tramo cuyo minuto ya pasó. El primer tramo debe empezar en el minuto 0.</p>
      <div className="comanda-config-preview" aria-label="Vista previa de los tramos">
        {ordenados.map((tramo, index) => <span key={index} style={{ background: tramo.color }}>{tramo.desde_minuto}′</span>)}
      </div>
      <ul className="comanda-config-tramos">
        {form.colores.map((tramo, index) => <li key={index}>
          <label>Desde el minuto<input type="number" min="0" max="1440" required value={tramo.desde_minuto} onChange={event => setTramo(index, { desde_minuto: event.target.value })} /></label>
          <label>Color<input type="color" value={tramo.color} onChange={event => setTramo(index, { color: event.target.value })} /></label>
          <button type="button" className="secondary" aria-label={`Quitar el tramo desde el minuto ${tramo.desde_minuto}`} disabled={form.colores.length <= 1} onClick={() => removeTramo(index)}>Quitar</button>
        </li>)}
      </ul>
    </section>

    <section className="invoice-card">
      <div className="invoice-card-head"><h3>Pase automático a TERMINADO</h3></div>
      <label className="comanda-config-switch"><input type="checkbox" checked={form.pase_automatico} onChange={event => change({ pase_automatico: event.target.checked })} /><span>Pasar a TERMINADO automáticamente al llegar al límite</span></label>
      <div className="invoice-grid">
        {NUMEROS.map(([name, label, hint]) => <label key={name}>{label}<input type="number" required min="1" value={form[name]} disabled={name === 'limite_terminado_min' && !form.pase_automatico} onChange={event => change({ [name]: event.target.value })} /><small className="muted">{hint}</small></label>)}
      </div>
      {form.pase_automatico && Number(form.limite_terminado_min) <= ultimo && <div className="alert info" role="status">El límite ({form.limite_terminado_min} min) es menor o igual al último tramo de color ({ultimo} min): el último color casi no se verá.</div>}
      {!form.pase_automatico && <div className="alert info" role="status">Con el pase automático apagado, los pedidos quedan en cocina hasta que alguien presione TERMINAR.</div>}
    </section>

    <div className="invoice-actions"><button className="primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
  </form>;
}
