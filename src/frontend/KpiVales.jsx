import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInteger, formatMoney } from './formatters.js';
import { ExcelIcon, PdfIcon } from './ActionIcons.jsx';
import './kpi-pedidos.css';
import './kpi-gastos.css';
import './kpi-vales.css';

// RR.HH. · Análisis de vales: adelantos pagados al personal en el período, por persona, cargo y forma de pago.
const colors = ['#d07a55', '#4f83c4', '#66aa8b', '#ab84be', '#d9a440', '#639ba8', '#dc7891'];
const dateOnly = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialRange = () => { const fin = new Date(); const inicio = new Date(fin); inicio.setDate(inicio.getDate() - 29); return { inicio: dateOnly(inicio), fin: dateOnly(fin), personal: '' }; };
const queryOf = r => new URLSearchParams(Object.entries(r).filter(([, value]) => value !== '')).toString();
const change = (current, previous) => previous ? `${current >= previous ? '+' : ''}${((current - previous) / previous * 100).toFixed(1)}%` : current ? 'Nuevo' : '0%';
const percent = value => value === null || value === undefined ? '—' : `${value.toFixed(1)}%`;
const shortDate = value => value ? `${value.slice(8, 10)}/${value.slice(5, 7)}` : '—';
const pagoLabel = { DIARIO: 'diario', SEMANAL: 'semanal', QUINCENAL: 'quincenal', MENSUAL: 'mensual' };
// Qué tan alto es lo adelantado respecto del sueldo del período.
const salaryClass = pct => pct === null ? 'is-none' : pct >= 50 ? 'is-high' : pct >= 25 ? 'is-mid' : 'is-low';

function Card({ title, subtitle, children, empty, wide }) {
  return <article className={`kpi-panel${wide ? ' voucher-wide' : ''}`}><div className="kpi-panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{empty ? <div className="kpi-chart-empty">Sin datos en este período</div> : children}</article>;
}

function Breakdown({ title, data }) {
  const [metric, setMetric] = useState('monto');
  const positive = data.filter(row => row[metric] > 0);
  return <Card title={title} subtitle="Cantidad e importe" empty={!data.length}>
    <div className="kpi-metric-choice kpi-delivery-choice"><span>Mostrar</span><button className={metric === 'cantidad' ? 'active' : ''} onClick={() => setMetric('cantidad')}>Cantidad</button><button className={metric === 'monto' ? 'active' : ''} onClick={() => setMetric('monto')}>Monto</button></div>
    <div className="kpi-donut-layout"><div className="kpi-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={positive} dataKey={metric} nameKey="nombre" innerRadius="62%" outerRadius="86%" paddingAngle={2}>{positive.map((row, index) => <Cell key={row.nombre} fill={colors[index % colors.length]} />)}</Pie><Tooltip formatter={value => metric === 'monto' ? formatMoney(value) : formatInteger(value)} /></PieChart></ResponsiveContainer></div>
      <div className="kpi-legend">{data.map((row, index) => <div className="kpi-delivery-item" key={row.nombre}><span className="kpi-dot" style={{ background: colors[index % colors.length] }} /><span title={row.nombre}>{row.nombre}</span><strong>{formatInteger(row.cantidad)} {row.cantidad === 1 ? 'vale' : 'vales'}<br />{formatMoney(row.monto)}</strong></div>)}</div></div>
  </Card>;
}

export default function KpiVales() {
  const [range, setRange] = useState(initialRange), [applied, setApplied] = useState(initialRange);
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [personal, setPersonal] = useState([]);
  useEffect(() => { fetch('/api/kpi-vales/opciones').then(r => r.ok ? r.json() : { personal: [] }).then(body => setPersonal(body.personal || [])).catch(() => {}); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/kpi-vales?${queryOf(applied)}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo cargar el análisis'); return body; })
      .then(setData).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied]);
  const submit = event => { event.preventDefault(); if (!range.inicio || !range.fin || range.inicio > range.fin) { setError('Ingresá un rango de fechas válido'); return; } setApplied({ ...range }); };
  const s = data?.resumen;
  const exportQuery = queryOf(applied);
  const blockIfBusy = event => { if (!data || loading) event.preventDefault(); };
  const people = (data?.personas || []).map(row => ({ ...row, etiqueta: `${row.nombre} (${row.cantidad} ${row.cantidad === 1 ? 'vale' : 'vales'})` }));

  return <div className="kpi-page">
    <TopbarSlot><form className="kpi-filters" onSubmit={submit}>
      <label>Desde<input type="date" required value={range.inicio} onChange={event => setRange({ ...range, inicio: event.target.value })} /></label>
      <label>Hasta<input type="date" required value={range.fin} onChange={event => setRange({ ...range, fin: event.target.value })} /></label>
      <label>Personal<select className="kpi-filter-select" value={range.personal} onChange={event => setRange({ ...range, personal: event.target.value })}><option value="">Todos</option>{personal.map(item => <option key={item.id} value={item.id}>{item.nombre}{item.activo ? '' : ' (inactivo)'}</option>)}</select></label>
      <button className="primary" disabled={loading}>Aplicar</button>
      <div className="kpi-export" aria-label="Exportar">
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/kpi-vales/reporte.xlsx?${exportQuery}`} download aria-disabled={!data || loading} onClick={blockIfBusy} title="Descargar Excel con los vales, el resumen por persona y gráficos"><ExcelIcon /><span>Excel</span></a>
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/kpi-vales/reporte.pdf?${exportQuery}`} target="_blank" rel="noopener noreferrer" aria-disabled={!data || loading} onClick={blockIfBusy} title="Abrir PDF con indicadores, gráficos y detalle"><PdfIcon /><span>PDF</span></a>
      </div>
    </form></TopbarSlot>
    {error && <div className="alert error" role="alert">{error}</div>}
    {loading && <div className="empty-state"><div className="loader" />Cargando indicadores…</div>}
    {!loading && data && <>
      <div className="kpi-summary expense-kpi-summary">
        <div><span>Total en vales</span><strong>{formatMoney(s.monto)}</strong><small>{change(s.monto, s.anterior.monto)} vs. período anterior</small></div>
        <div><span>Vales pagados</span><strong>{formatInteger(s.cantidad)}</strong><small>{formatInteger(s.personas)} {s.personas === 1 ? 'persona' : 'personas'} · {change(s.cantidad, s.anterior.cantidad)} vs. anterior</small></div>
        <div><span>Vale promedio</span><strong>{formatMoney(s.promedio)}</strong><small>Total / vales pagados</small></div>
        <div><span>Del sueldo del período</span><strong>{percent(s.pct_sueldo)}</strong><small>{s.pct_sueldo === null ? 'Sin sueldos cargados en Personal' : `Sobre ${formatMoney(s.sueldo_periodo)} (aprox.)`}{s.anulados.cantidad ? ` · ${formatInteger(s.anulados.cantidad)} ${s.anulados.cantidad === 1 ? 'anulado' : 'anulados'} aparte` : ''}</small></div>
      </div>
      <div className="kpi-grid">
        <Card title="Evolución diaria" subtitle="Cantidad e importe de vales pagados"><div className="kpi-chart wide"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.dias} margin={{ top: 14, right: 12, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edf3" /><XAxis dataKey="fecha" tickFormatter={shortDate} minTickGap={18} /><YAxis yAxisId="count" allowDecimals={false} width={35} /><YAxis yAxisId="amount" orientation="right" tickFormatter={formatInteger} width={75} /><Tooltip formatter={(value, name) => name === 'Importe' ? formatMoney(value) : formatInteger(value)} labelFormatter={shortDate} /><Legend /><Bar yAxisId="count" dataKey="cantidad" name="Vales" fill={colors[0]} radius={[5, 5, 0, 0]} maxBarSize={26} /><Line yAxisId="amount" type="monotone" dataKey="monto" name="Importe" stroke={colors[1]} strokeWidth={3} dot={false} activeDot={{ r: 5 }} /></ComposedChart></ResponsiveContainer></div></Card>
        <Card title="Vales por persona" subtitle="Importe pagado en el período (cantidad de vales entre paréntesis)" empty={!people.length} wide>
          <div className="voucher-chart" style={{ height: Math.max(140, people.length * 36 + 30) }}><ResponsiveContainer width="100%" height="100%"><BarChart data={people} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#e8edf3" /><XAxis type="number" tickFormatter={formatInteger} /><YAxis dataKey="etiqueta" type="category" width={210} tick={{ fontSize: 12 }} interval={0} /><Tooltip formatter={value => formatMoney(value)} /><Bar dataKey="monto" name="Importe" radius={[0, 5, 5, 0]} maxBarSize={24}>{people.map((row, index) => <Cell key={row.id} fill={colors[index % colors.length]} />)}</Bar></BarChart></ResponsiveContainer></div>
        </Card>
        <Breakdown title="Vales por cargo" data={data.cargos} />
        <Breakdown title="Formas de pago" data={data.formas} />
        <Card title="Días de la semana" subtitle="Importe acumulado por día"><div className="kpi-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.semana} layout="vertical" margin={{ top: 5, right: 20, left: 18, bottom: 5 }}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#e8edf3" /><XAxis type="number" tickFormatter={formatInteger} /><YAxis dataKey="nombre" type="category" width={75} /><Tooltip formatter={formatMoney} /><Bar dataKey="monto" name="Importe" fill={colors[0]} radius={[0, 5, 5, 0]} /></BarChart></ResponsiveContainer></div></Card>
        <Card title="Resumen por persona" subtitle={`% del sueldo: vales del período sobre el sueldo de ${formatInteger(data.dias_periodo)} días según su tipo de pago (aproximado)`} empty={!people.length} wide>
          <div className="catalog-table-wrap voucher-table-wrap"><table className="catalog-table voucher-table"><thead><tr><th>Persona</th><th className="numeric-cell">Vales</th><th className="numeric-cell">Total</th><th className="numeric-cell">Promedio</th><th className="numeric-cell">Mayor</th><th>Último</th><th className="numeric-cell">Sueldo</th><th className="numeric-cell">% del sueldo</th></tr></thead>
            <tbody>{people.map(row => <tr key={row.id} className={row.activo ? '' : 'inactive-row'}>
              <td><strong>{row.nombre}</strong><small>{row.cargo || 'Sin cargo'}{row.activo ? '' : ' · inactivo'}{row.limite_monto_vale ? ` · límite por vale ${formatMoney(row.limite_monto_vale)}` : ''}</small></td>
              <td className="numeric-cell">{formatInteger(row.cantidad)}</td>
              <td className="numeric-cell"><strong>{formatMoney(row.monto)}</strong></td>
              <td className="numeric-cell">{formatMoney(row.promedio)}</td>
              <td className="numeric-cell">{formatMoney(row.mayor)}</td>
              <td>{shortDate(row.ultimo)}</td>
              <td className="numeric-cell">{row.monto_pago ? <>{formatMoney(row.monto_pago)}<small>{pagoLabel[row.tipo_pago] || ''}</small></> : <span className="muted">Sin cargar</span>}</td>
              <td className="numeric-cell"><span className={`voucher-badge ${salaryClass(row.pct_sueldo)}`}>{percent(row.pct_sueldo)}</span></td>
            </tr>)}</tbody>
            {people.length > 1 && <tfoot><tr className="rrhh-total-row"><td>Total</td><td className="numeric-cell">{formatInteger(s.cantidad)}</td><td className="numeric-cell">{formatMoney(s.monto)}</td><td className="numeric-cell">{formatMoney(s.promedio)}</td><td colSpan="3" /><td className="numeric-cell">{percent(s.pct_sueldo)}</td></tr></tfoot>}
          </table></div>
        </Card>
      </div>
      <p className="kpi-footnote">Los importes se agrupan por fecha del vale. Los anulados se muestran aparte y no suman. El sueldo del período es aproximado: diario × días, semanal ÷ 7, quincenal ÷ 15 y mensual ÷ 30 por día corrido.</p>
    </>}
  </div>;
}
