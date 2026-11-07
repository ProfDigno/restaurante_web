import { useEffect, useMemo, useState } from 'react';
import TopbarSlot from './TopbarSlot.jsx';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInteger, formatMoney } from './formatters.js';
import { ExcelIcon, PdfIcon } from './ActionIcons.jsx';
import './kpi-pedidos.css';
import './kpi-gastos.css';
import './kpi-rentabilidad.css';

// Análisis de rentabilidad: venta, costo y margen por producto y categoría del período.
const colors = ['#66aa8b', '#4f83c4', '#d07a55', '#ab84be', '#d9a440', '#639ba8', '#dc7891'];
const dateOnly = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const initialRange = () => { const fin = new Date(); const inicio = new Date(fin); inicio.setDate(inicio.getDate() - 29); return { inicio: dateOnly(inicio), fin: dateOnly(fin), categoria: '' }; };
const queryOf = r => new URLSearchParams(Object.entries(r).filter(([, value]) => value !== '')).toString();
const change = (current, previous) => previous ? `${current >= previous ? '+' : ''}${((current - previous) / Math.abs(previous) * 100).toFixed(1)}%` : current ? 'Nuevo' : '0%';
const percent = value => `${value.toFixed(1)}%`;
const marginClass = row => row.sin_costo ? 'is-missing' : row.margen < 0 ? 'is-loss' : row.margen_pct < 30 ? 'is-low' : row.margen_pct < 55 ? 'is-mid' : 'is-good';

function Card({ title, subtitle, children, empty, wide }) {
  return <article className={`kpi-panel${wide ? ' profit-wide' : ''}`}><div className="kpi-panel-heading"><div><h3>{title}</h3><p>{subtitle}</p></div></div>{empty ? <div className="kpi-chart-empty">Sin datos en este período</div> : children}</article>;
}

function MarginBars({ rows, dataKey = 'margen', color }) {
  const height = Math.max(160, rows.length * 34 + 30);
  return <div className="profit-chart" style={{ height }}><ResponsiveContainer width="100%" height="100%">
    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 70, left: 8, bottom: 4 }}>
      <CartesianGrid strokeDasharray="3 5" horizontal={false} stroke="#e8edf3" />
      <XAxis type="number" tickFormatter={dataKey === 'margen_pct' ? value => `${value}%` : formatInteger} domain={dataKey === 'margen_pct' ? [Math.min(0, ...rows.map(row => Math.floor(row.margen_pct / 10) * 10)), 100] : [dataMin => Math.min(0, dataMin), 'auto']} />
      <YAxis dataKey={rows[0]?.etiqueta ? 'etiqueta' : 'nombre'} type="category" width={240} tick={{ fontSize: 11 }} interval={0} tickFormatter={value => value.length > 40 ? `${value.slice(0, 39)}…` : value} />
      <Tooltip formatter={(value, name, item) => dataKey === 'margen_pct' ? [percent(value), 'Margen %'] : [`${formatMoney(value)} · ${percent(item.payload.margen_pct)}`, 'Margen']} />
      <Bar dataKey={dataKey} radius={[0, 5, 5, 0]} maxBarSize={22}>
        {rows.map((row, index) => <Cell key={row.id} fill={row.margen < 0 ? '#c4513f' : row.sin_costo || row.costo_sospechoso ? '#c3ccd5' : color || colors[index % colors.length]} />)}
        <LabelList dataKey="margen_pct" position="right" formatter={percent} style={{ fontSize: 11, fill: '#526277' }} />
      </Bar>
    </BarChart>
  </ResponsiveContainer></div>;
}

const columns = [
  ['nombre', 'Producto'], ['unidades', 'Unid.'], ['venta', 'Venta'], ['costo', 'Costo'], ['margen', 'Margen'], ['margen_pct', 'Margen %']
];

function ProductTable({ rows }) {
  const [sort, setSort] = useState({ key: 'margen', dir: -1 });
  const [search, setSearch] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const visible = useMemo(() => {
    const text = search.trim().toLowerCase();
    return rows.filter(row => (!text || `${row.nombre} ${row.categoria}`.toLowerCase().includes(text)) && (!onlyMissing || row.sin_costo || row.costo_incompleto || row.costo_sospechoso))
      .sort((a, b) => sort.key === 'nombre' ? a.nombre.localeCompare(b.nombre) * sort.dir : (a[sort.key] - b[sort.key]) * sort.dir);
  }, [rows, sort, search, onlyMissing]);
  const toggle = key => setSort(current => ({ key, dir: current.key === key ? -current.dir : key === 'nombre' ? 1 : -1 }));
  return <>
    <div className="profit-table-tools">
      <div className="search-box"><span>⌕</span><input placeholder="Buscar producto o categoría…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <label className="profit-check"><input type="checkbox" checked={onlyMissing} onChange={event => setOnlyMissing(event.target.checked)} /> Solo con costo faltante o sospechoso</label>
      <span className="muted">{visible.length} de {rows.length} productos</span>
    </div>
    <div className="catalog-table-wrap"><table className="catalog-table profit-table"><thead><tr>
      {columns.map(([key, label]) => <th key={key} className={key === 'nombre' ? '' : 'numeric-cell'}><button type="button" className="profit-sort" onClick={() => toggle(key)} aria-label={`Ordenar por ${label}`}>{label}{sort.key === key ? (sort.dir < 0 ? ' ↓' : ' ↑') : ''}</button></th>)}
    </tr></thead><tbody>
      {!visible.length ? <tr><td colSpan={columns.length} className="table-empty">Sin productos para mostrar</td></tr> : visible.map(row => <tr key={row.id} className={row.sin_costo ? 'inactive-row' : ''}>
        <td><strong>{row.nombre}</strong><small>{row.categoria} · {row.unidad}{row.sin_costo ? ' · Sin costo cargado' : row.costo_incompleto ? ' · Costo incompleto: algunas ventas sin costo' : row.costo_sospechoso ? ' · Costo sospechoso: menos del 1% de la venta' : row.estimado ? ' · Costo estimado' : ''}</small></td>
        <td className="numeric-cell">{formatInteger(row.unidades)}</td>
        <td className="numeric-cell">{formatMoney(row.venta)}</td>
        <td className="numeric-cell">{formatMoney(row.costo)}</td>
        <td className="numeric-cell"><strong className={row.margen < 0 ? 'profit-loss' : ''}>{formatMoney(row.margen)}</strong></td>
        <td className="numeric-cell"><span className={`profit-badge ${marginClass(row)}`}>{row.sin_costo ? '—' : percent(row.margen_pct)}</span></td>
      </tr>)}
    </tbody></table></div>
  </>;
}

export default function KpiRentabilidad() {
  const [range, setRange] = useState(initialRange), [applied, setApplied] = useState(initialRange);
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [categorias, setCategorias] = useState([]);
  useEffect(() => { fetch('/api/kpi-rentabilidad/opciones').then(r => r.ok ? r.json() : { categorias: [] }).then(body => setCategorias(body.categorias || [])).catch(() => {}); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/kpi-rentabilidad?${queryOf(applied)}`, { signal: controller.signal })
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo cargar el análisis'); return body; })
      .then(setData).catch(err => { if (err.name !== 'AbortError') setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied]);
  const submit = event => { event.preventDefault(); if (!range.inicio || !range.fin || range.inicio > range.fin) { setError('Ingresá un rango de fechas válido'); return; } setApplied({ ...range }); };
  const s = data?.resumen;
  const exportQuery = queryOf(applied);
  const blockIfBusy = event => { if (!data || loading) event.preventDefault(); };
  const withCost = data?.productos.filter(row => !row.sin_costo && !row.costo_sospechoso && row.venta > 0) || [];
  const lowest = [...withCost].sort((a, b) => a.margen_pct - b.margen_pct).slice(0, 10);

  return <div className="kpi-page">
    <TopbarSlot><form className="kpi-filters" onSubmit={submit}>
      <label>Desde<input type="date" required value={range.inicio} onChange={event => setRange({ ...range, inicio: event.target.value })} /></label>
      <label>Hasta<input type="date" required value={range.fin} onChange={event => setRange({ ...range, fin: event.target.value })} /></label>
      <label>Categoría<select className="kpi-filter-select" value={range.categoria} onChange={event => setRange({ ...range, categoria: event.target.value })}><option value="">Todas</option>{categorias.map(item => <option key={item.id} value={item.id}>{item.nombre}{item.activo ? '' : ' (inactiva)'}</option>)}</select></label>
      <button className="primary" disabled={loading}>Aplicar</button>
      <div className="kpi-export" aria-label="Exportar">
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/kpi-rentabilidad/reporte.xlsx?${exportQuery}`} download aria-disabled={!data || loading} onClick={blockIfBusy} title="Descargar Excel con el detalle por producto, totales y gráficos"><ExcelIcon /><span>Excel</span></a>
        <a className={`secondary kpi-export-button${!data || loading ? ' disabled' : ''}`} href={`/api/kpi-rentabilidad/reporte.pdf?${exportQuery}`} target="_blank" rel="noopener noreferrer" aria-disabled={!data || loading} onClick={blockIfBusy} title="Abrir PDF con indicadores, gráficos y detalle"><PdfIcon /><span>PDF</span></a>
      </div>
    </form></TopbarSlot>
    {error && <div className="alert error" role="alert">{error}</div>}
    {loading && <div className="empty-state"><div className="loader" />Cargando indicadores…</div>}
    {!loading && data && <>
      {s.productos_con_perdida > 0 && <div className="alert error" role="status"><strong>{formatInteger(s.productos_con_perdida)} {s.productos_con_perdida === 1 ? 'producto se vendió' : 'productos se vendieron'} por debajo del costo</strong> (pérdida de {formatMoney(Math.abs(s.perdida))}). Revisá su precio de venta o de compra; figuran en rojo en el detalle.</div>}
      {s.productos_costo_sospechoso > 0 && <div className="alert profit-warning" role="status"><strong>{formatInteger(s.productos_costo_sospechoso)} productos tienen un costo sospechosamente bajo</strong> (menos del 1% de su venta; {formatMoney(s.venta_costo_sospechoso)} de venta), por ejemplo precio de compra de 1 Gs. Su margen figura cerca del 100%. Revisalos con el filtro del detalle.</div>}
      {s.productos_sin_costo > 0 && <div className="alert profit-warning" role="status"><strong>{formatInteger(s.productos_sin_costo)} {s.productos_sin_costo === 1 ? 'producto tiene' : 'productos tienen'} ventas sin costo cargado</strong> ({formatMoney(s.venta_sin_costo)} de venta). Esas ventas cuentan como 100% de margen y suben el margen total. Cargá el precio de compra en <em>Productos del menú</em>; se aplica a las ventas nuevas.</div>}
      <div className="kpi-summary expense-kpi-summary">
        <div><span>Venta de productos</span><strong>{formatMoney(s.venta)}</strong><small>{change(s.venta, s.anterior.venta)} vs. período anterior</small></div>
        <div><span>Costo</span><strong>{formatMoney(s.costo)}</strong><small>{percent(s.venta ? s.costo / s.venta * 100 : 0)} de la venta</small></div>
        <div><span>Margen bruto</span><strong>{formatMoney(s.margen)}</strong><small>{percent(s.margen_pct)} · {change(s.margen, s.anterior.margen)} vs. anterior</small></div>
        {s.margen_neto === null
          ? <div><span>Unidades vendidas</span><strong>{formatInteger(s.unidades)}</strong><small>{formatInteger(s.pedidos)} pedidos</small></div>
          : <div><span>Margen neto</span><strong>{formatMoney(s.margen_neto)}</strong><small>Descuentos: {formatMoney(s.descuentos)}</small></div>}
      </div>
      <div className="kpi-grid profit-grid">
        <Card title="Margen por categoría" subtitle="Margen bruto en guaraníes y % sobre la venta de la categoría" empty={!data.categorias.length}>
          <MarginBars rows={data.categorias} />
        </Card>
        <Card title="Productos que más margen dejan" subtitle="Diez productos con mayor margen bruto · en gris, sin costo o con costo sospechoso" empty={!data.productos.some(row => row.margen > 0)}>
          <MarginBars rows={data.productos.filter(row => row.margen > 0).slice(0, 10)} color="#66aa8b" />
        </Card>
        <Card title="Productos con menor margen %" subtitle="Diez productos con costo cargado y menor margen sobre su venta" empty={!lowest.length}>
          <MarginBars rows={lowest} dataKey="margen_pct" color="#d07a55" />
        </Card>
        <Card title="Detalle por producto" subtitle="Tocá un encabezado para ordenar" wide empty={!data.productos.length}>
          <ProductTable rows={data.productos} />
        </Card>
      </div>
      <p className="kpi-footnote">Pedidos por fecha de confirmación, sin anulados. Venta = precio de venta × cantidad + ingredientes agregados cobrados; costo = precio de compra guardado al vender (o la receta, si el producto tiene una). No incluye delivery ni recargos. {s.lineas_estimadas ? `${formatInteger(s.lineas_estimadas)} líneas usan el precio actual del ingrediente (costo estimado).` : ''}{s.margen_neto === null ? ' Con filtro de categoría no se restan descuentos: son del pedido entero.' : ''}</p>
    </>}
  </div>;
}
