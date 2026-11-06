import { useEffect, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInteger, formatMoney } from './formatters.js';
import { ExcelIcon, PdfIcon } from './ActionIcons.jsx';
import './kpi-pedidos.css';
import './kpi-gastos.css';

// Análisis de compras: solo suman las compras recibidas; borradores y canceladas se muestran aparte.
const colors=['#d07a55','#4f83c4','#66aa8b','#ab84be','#d9a440','#639ba8','#dc7891'];
const dateOnly=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const initialRange=()=>{const fin=new Date();const inicio=new Date(fin);inicio.setDate(inicio.getDate()-29);return {inicio:dateOnly(inicio),fin:dateOnly(fin)};};
const change=(current,previous)=>previous?`${current>=previous?'+':''}${((current-previous)/previous*100).toFixed(1)}%`:current?'Nuevo':'0%';
function Card({title,subtitle,children,empty}){return <article className="kpi-panel"><div className="kpi-panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{empty?<div className="kpi-chart-empty">Sin datos en este período</div>:children}</article>;}
function Breakdown({title,subtitle,data,unit}){
  const [metric,setMetric]=useState('monto');
  const positive=data.filter(row=>row[metric]>0);
  return <Card title={title} subtitle={subtitle} empty={!data.length}><div className="kpi-metric-choice kpi-delivery-choice"><span>Mostrar</span><button className={metric==='cantidad'?'active':''} onClick={()=>setMetric('cantidad')}>Cantidad</button><button className={metric==='monto'?'active':''} onClick={()=>setMetric('monto')}>Monto</button></div><div className="kpi-donut-layout"><div className="kpi-donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={positive} dataKey={metric} nameKey="nombre" innerRadius="62%" outerRadius="86%" paddingAngle={2}>{positive.map((row,index)=><Cell key={row.id} fill={colors[index%colors.length]}/>)}</Pie><Tooltip formatter={value=>metric==='monto'?formatMoney(value):formatInteger(value)}/></PieChart></ResponsiveContainer></div><div className="kpi-legend">{data.map((row,index)=><div className="kpi-delivery-item" key={row.id}><span className="kpi-dot" style={{background:colors[index%colors.length]}}/><span title={row.nombre}>{row.nombre}</span><strong>{formatInteger(row.cantidad)} {unit}<br/>{formatMoney(row.monto)}</strong></div>)}</div></div></Card>;
}
function HorizontalBars({title,subtitle,data,height=280,name='Importe',labelWidth=150}){
  return <Card title={title} subtitle={subtitle} empty={!data.some(row=>row.monto>0)}><div className="kpi-chart" style={{height}}><ResponsiveContainer width="100%" height="100%"><BarChart data={data} layout="vertical" margin={{top:5,right:20,left:8,bottom:5}}><CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#e8edf3"/><XAxis type="number" tickFormatter={formatInteger}/><YAxis dataKey="nombre" type="category" width={labelWidth} tick={{fontSize:12}}/><Tooltip formatter={formatMoney}/><Bar dataKey="monto" name={name} fill={colors[0]} radius={[0,5,5,0]}/></BarChart></ResponsiveContainer></div></Card>;
}
export default function KpiCompras(){
  const [range,setRange]=useState(initialRange),[applied,setApplied]=useState(initialRange),[data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');fetch(`/api/kpi-compras?inicio=${applied.inicio}&fin=${applied.fin}`,{signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo cargar el análisis');return body;}).then(setData).catch(err=>{if(err.name!=='AbortError')setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[applied]);
  const submit=event=>{event.preventDefault();if(!range.inicio||!range.fin||range.inicio>range.fin){setError('Ingresá un rango de fechas válido');return;}setApplied({...range});};
  const s=data?.resumen;
  // Exporta el período aplicado (el que se ve en pantalla), no el que se está editando.
  const exportQuery=new URLSearchParams({inicio:applied.inicio,fin:applied.fin}).toString();
  const blockIfBusy=event=>{if(!data||loading)event.preventDefault();};
  const exportDisabled=!data||loading;
  return <div className="kpi-page"><TopbarSlot><form className="kpi-filters" onSubmit={submit}><label>Desde<input type="date" required value={range.inicio} onChange={event=>setRange({...range,inicio:event.target.value})}/></label><label>Hasta<input type="date" required value={range.fin} onChange={event=>setRange({...range,fin:event.target.value})}/></label><button className="primary" disabled={loading}>Aplicar</button>
    <div className="kpi-export" aria-label="Exportar"><a className={`secondary kpi-export-button${exportDisabled?' disabled':''}`} href={`/api/kpi-compras/reporte.xlsx?${exportQuery}`} download aria-disabled={exportDisabled} onClick={blockIfBusy} title="Descargar Excel con las compras filtradas, totales y gráficos"><ExcelIcon/><span>Excel</span></a><a className={`secondary kpi-export-button${exportDisabled?' disabled':''}`} href={`/api/kpi-compras/reporte.pdf?${exportQuery}`} target="_blank" rel="noopener noreferrer" aria-disabled={exportDisabled} onClick={blockIfBusy} title="Abrir PDF con las compras filtradas, totales y gráficos"><PdfIcon/><span>PDF</span></a></div></form></TopbarSlot>
    {error&&<div className="alert error" role="alert">{error}</div>}{loading&&<div className="empty-state"><div className="loader"/>Cargando indicadores…</div>}
    {!loading&&data&&<><div className="kpi-summary expense-kpi-summary"><div><span>Total comprado</span><strong>{formatMoney(s.monto)}</strong><small>{change(s.monto,s.anterior.monto)} vs. período anterior</small></div><div><span>Compras recibidas</span><strong>{formatInteger(s.cantidad)}</strong><small>{change(s.cantidad,s.anterior.cantidad)} vs. período anterior · promedio {formatMoney(s.promedio)}</small></div><div><span>Saldo pendiente</span><strong>{formatMoney(s.saldo)}</strong><small>{formatInteger(s.pendientes)} compras con saldo · pagado {formatMoney(s.pagado)}</small></div><div><span>Canceladas / borradores</span><strong>{formatInteger(s.canceladas.cantidad)} / {formatInteger(s.borradores.cantidad)}</strong><small>{formatMoney(s.canceladas.monto)} canceladas · {formatMoney(s.borradores.monto)} sin recibir</small></div></div>
      <div className="kpi-grid"><Card title="Evolución diaria" subtitle="Cantidad e importe de compras recibidas"><div className="kpi-chart wide"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data.dias} margin={{top:14,right:12,left:4,bottom:0}}><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edf3"/><XAxis dataKey="fecha" tickFormatter={value=>`${value.slice(8,10)}/${value.slice(5,7)}`} minTickGap={18}/><YAxis yAxisId="count" allowDecimals={false} width={35}/><YAxis yAxisId="amount" orientation="right" tickFormatter={formatInteger} width={75}/><Tooltip formatter={(value,name)=>name==='Importe'?formatMoney(value):formatInteger(value)}/><Legend/><Bar yAxisId="count" dataKey="cantidad" name="Compras" fill={colors[0]} radius={[5,5,0,0]} maxBarSize={26}/><Line yAxisId="amount" type="monotone" dataKey="monto" name="Importe" stroke={colors[1]} strokeWidth={3} dot={false} activeDot={{r:5}}/></ComposedChart></ResponsiveContainer></div></Card>
      <HorizontalBars title="Proveedores" subtitle="Importe comprado por proveedor" data={data.proveedores} height={Math.max(220,data.proveedores.length*38+40)}/>
      <Breakdown title="Contado y crédito" subtitle="Compras e importe por condición" data={data.condiciones} unit="compras"/>
      <Breakdown title="Formas de pago" subtitle="Pagos registrados de las compras del período" data={data.formas} unit="pagos"/>
      <HorizontalBars title="Productos más comprados" subtitle="Diez productos con mayor importe" data={data.productos} height={Math.max(220,data.productos.length*34+40)} labelWidth={190}/>
      <HorizontalBars title="Días de la semana" subtitle="Importe acumulado por día" data={data.semana} labelWidth={75}/>
      <Card title="Saldo por proveedor" subtitle="Compras recibidas con pago pendiente" empty={!data.proveedores.some(row=>row.saldo>0)}><div className="expense-top-list">{data.proveedores.filter(row=>row.saldo>0).map(row=><div key={row.id}><span><strong>{row.nombre}</strong><small>{formatInteger(row.cantidad)} compras · {formatMoney(row.monto)} en total</small></span><strong>{formatMoney(row.saldo)}</strong></div>)}</div></Card></div>
      <p className="kpi-footnote">Los importes se agrupan por fecha de compra. Solo suman las compras recibidas; las canceladas y los borradores se muestran aparte.</p></>}
  </div>;
}
