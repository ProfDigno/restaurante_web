import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInteger, formatMoney } from './formatters.js';
import './kpi-pedidos.css';

const colors = ['#5271d8','#39a88c','#f4aa55','#a77bd5','#ec7385','#6fa8b7','#9fba60','#e88b5e'];
const weekNames = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const dateOnly = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const initialRange = () => { const end = new Date(); const start = new Date(end); start.setDate(start.getDate()-29); return { inicio: dateOnly(start), fin: dateOnly(end) }; };
const shortDate = value => `${value.slice(8,10)}/${value.slice(5,7)}`;
const percentChange = (current, previous) => previous ? `${current >= previous ? '+' : ''}${((current-previous)/previous*100).toFixed(1)}%` : current ? 'Nuevo' : '0%';

function ChartCard({ title, subtitle, children, empty }) {
  return <article className="kpi-panel"><div className="kpi-panel-heading"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div></div>{empty ? <div className="kpi-chart-empty">Sin datos en este período</div> : children}</article>;
}

function Ranking({ title, data, metric, label = 'unidades' }) {
  const sorted = [...data].sort((a,b) => b[metric]-a[metric]).slice(0, 10);
  return <ChartCard title={title} subtitle={`Top 10 · ${label}`} empty={!sorted.length}><div className="kpi-ranking">{sorted.map((item,index) => <div className="kpi-rank" key={item.id || item.nombre}><span className="kpi-rank-num">{String(index+1).padStart(2,'0')}</span><span className="kpi-rank-name" title={item.nombre}>{item.nombre}</span><span className="kpi-rank-track"><span style={{ width: `${sorted[0][metric] ? Math.max(3,100*item[metric]/sorted[0][metric]) : 0}%`, background: colors[index%colors.length] }} /></span><strong>{metric === 'monto' ? formatMoney(item.monto) : formatInteger(item[metric])}</strong></div>)}</div></ChartCard>;
}

function Donut({ title, data, valueKey, emptyLabel }) {
  const positive = data.filter(item => item[valueKey] > 0);
  return <ChartCard title={title} subtitle={emptyLabel} empty={!positive.length}><div className="kpi-donut-layout"><div className="kpi-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={positive} dataKey={valueKey} nameKey="nombre" innerRadius="62%" outerRadius="86%" paddingAngle={2}>{positive.map((item,index)=><Cell key={item.nombre} fill={colors[index%colors.length]} />)}</Pie><Tooltip formatter={value => valueKey === 'monto' ? formatMoney(value) : formatInteger(value)} /></PieChart></ResponsiveContainer></div><div className="kpi-legend">{positive.map((item,index)=><div key={item.nombre}><span className="kpi-dot" style={{background:colors[index%colors.length]}} /><span>{item.nombre}</span><strong>{valueKey === 'monto' ? formatMoney(item[valueKey]) : formatInteger(item[valueKey])}</strong></div>)}</div></div></ChartCard>;
}

function DeliveryChart({ data }) {
  const [metric, setMetric] = useState('pedidos');
  const positive = data.filter(item => item[metric] > 0);
  return <ChartCard title="Tipos de entrega" subtitle="Cantidad y venta por modalidad" empty={!data.length}>
    <div className="kpi-metric-choice kpi-delivery-choice"><span>Mostrar</span><button className={metric==='pedidos'?'active':''} onClick={()=>setMetric('pedidos')}>Cantidad</button><button className={metric==='monto'?'active':''} onClick={()=>setMetric('monto')}>Monto</button></div>
    <div className="kpi-donut-layout"><div className="kpi-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={positive} dataKey={metric} nameKey="nombre" innerRadius="62%" outerRadius="86%" paddingAngle={2}>{positive.map((item,index)=><Cell key={item.nombre} fill={colors[index%colors.length]} />)}</Pie><Tooltip formatter={value => metric==='monto' ? formatMoney(value) : formatInteger(value)} /></PieChart></ResponsiveContainer></div><div className="kpi-legend">{data.map((item,index)=><div className="kpi-delivery-item" key={item.nombre}><span className="kpi-dot" style={{background:colors[index%colors.length]}} /><span>{item.nombre}</span><strong>{formatInteger(item.pedidos)} pedidos<br/>{formatMoney(item.monto)}</strong></div>)}</div></div>
  </ChartCard>;
}

export default function KpiPedidos() {
  const [range, setRange] = useState(initialRange);
  const [applied, setApplied] = useState(initialRange);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState('unidades');
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError('');
    fetch(`/api/kpi-pedidos?inicio=${applied.inicio}&fin=${applied.fin}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo cargar el análisis'); return body; })
      .then(setData).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort(); }, [applied]);
  const submit = event => { event.preventDefault(); if (!range.inicio || !range.fin || range.inicio > range.fin) { setError('Ingresá un rango de fechas válido'); return; } setApplied({...range}); };
  const weekdays = weekNames.map((nombre,index) => ({nombre, pedidos: 0, monto: 0, index}));
  data?.dias.forEach(day => { const index = new Date(`${day.fecha}T12:00:00Z`).getUTCDay(); weekdays[index].pedidos += day.pedidos; weekdays[index].monto += day.monto; });
  const overview = data?.resumen;
  return <div className="kpi-page"><div className="kpi-hero"><div><p className="eyebrow">OPERACIÓN · INTELIGENCIA DE VENTAS</p><h2>Análisis de pedidos</h2><p>Explorá ventas confirmadas, productos, clientes y cobros en el período elegido.</p></div><form className="kpi-filters" onSubmit={submit}><label>Desde<input type="date" value={range.inicio} onChange={event=>setRange({...range,inicio:event.target.value})} required /></label><label>Hasta<input type="date" value={range.fin} onChange={event=>setRange({...range,fin:event.target.value})} required /></label><button className="primary" disabled={loading}>Aplicar</button></form></div>
    {error && <div className="alert error">{error}</div>}{loading && <div className="empty-state"><div className="loader" />Cargando indicadores…</div>}
    {!loading && data && <><div className="kpi-summary"><div><span>Ventas confirmadas</span><strong>{formatMoney(overview.monto)}</strong><small>{percentChange(overview.monto,overview.anterior.monto)} vs. período anterior</small></div><div><span>Pedidos</span><strong>{formatInteger(overview.pedidos)}</strong><small>{percentChange(overview.pedidos,overview.anterior.pedidos)} vs. período anterior</small></div><div><span>Ticket promedio</span><strong>{formatMoney(overview.ticket_promedio)}</strong><small>Venta total / pedidos</small></div><div><span>Clientes nuevos</span><strong>{formatInteger(overview.clientes_nuevos)}</strong><small>Primera compra confirmada</small></div></div>
      <div className="kpi-grid"><ChartCard title="Evolución diaria" subtitle="Cantidad de pedidos y monto confirmado"><div className="kpi-chart wide"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.dias} margin={{top:14,right:12,left:4,bottom:0}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edf3"/><XAxis dataKey="fecha" tickFormatter={shortDate} minTickGap={18} /><YAxis yAxisId="count" allowDecimals={false} width={35}/><YAxis yAxisId="amount" orientation="right" tickFormatter={value=>formatInteger(value)} width={75}/><Tooltip labelFormatter={value=>value} formatter={(value,name)=>name==='Monto' ? formatMoney(value) : formatInteger(value)} /><Legend/><Bar yAxisId="count" dataKey="pedidos" name="Pedidos" fill={colors[0]} radius={[5,5,0,0]} maxBarSize={26}/><Line yAxisId="amount" type="monotone" dataKey="monto" name="Monto" stroke={colors[1]} strokeWidth={3} dot={false} activeDot={{r:5}}/></ComposedChart></ResponsiveContainer></div></ChartCard>
      <DeliveryChart data={data.entregas}/><Donut title="Cobros por forma de pago" data={data.pagos} valueKey="monto" emptyLabel="Pagos aprobados menos devoluciones · fecha de cobro"/>
      <ChartCard title="Días de la semana" subtitle="Ventas acumuladas por día"><div className="kpi-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={weekdays} layout="vertical" margin={{top:5,right:20,left:18,bottom:5}}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#e8edf3"/><XAxis type="number" tickFormatter={value=>formatInteger(value)}/><YAxis dataKey="nombre" type="category" width={75}/><Tooltip formatter={value=>formatMoney(value)}/><Bar dataKey="monto" name="Monto" fill={colors[0]} radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></ChartCard>
      <div className="kpi-metric-choice"><span>Ranking por</span><button className={metric==='unidades'?'active':''} onClick={()=>setMetric('unidades')}>Unidades</button><button className={metric==='monto'?'active':''} onClick={()=>setMetric('monto')}>Monto</button></div>
      <Ranking title="Grupos más vendidos" data={data.grupos} metric={metric} label={metric}/><Ranking title="Categorías más vendidas" data={data.categorias} metric={metric} label={metric}/><Ranking title="Productos más vendidos" data={data.productos} metric={metric} label={metric}/><Ranking title="Mesas más usadas" data={data.mesas} metric="pedidos" label="pedidos"/><Ranking title="Zonas de clientes" data={data.zonas} metric="pedidos" label="pedidos delivery"/></div>
      <p className="kpi-footnote">Ventas por fecha de confirmación. Los rankings de productos usan importes de líneas y pueden diferir del total por descuentos, recargos y delivery. Los cobros se agrupan por fecha de pago.</p></>}
  </div>;
}
