import { useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInteger, formatMoney } from './formatters.js';

// Gráfico de evolución compartido por los análisis (pedidos, gastos, compras, vales): cantidad en barras y
// monto en línea, por día o por mes. La vista mensual suma por mes los mismos datos diarios que manda el servidor.
const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const dayLabel = value => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
const monthLabel = value => `${monthNames[Number(value.slice(5, 7)) - 1]} ${value.slice(2, 4)}`;

export function byMonth(dias, countKey) {
  return Object.values(dias.reduce((acc, day) => {
    const key = day.fecha.slice(0, 7);
    acc[key] = acc[key] || { fecha: key, [countKey]: 0, monto: 0 };
    acc[key][countKey] += Number(day[countKey] || 0);
    acc[key].monto += Number(day.monto || 0);
    return acc;
  }, {}));
}

// Recuerda por pantalla la última vista elegida (si el navegador no permite guardar, arranca en diaria).
export function useEvolutionPeriod(storageKey) {
  const [period, setState] = useState(() => { try { return localStorage.getItem(storageKey) === 'mes' ? 'mes' : 'dia'; } catch { return 'dia'; } });
  const setPeriod = value => { setState(value); try { localStorage.setItem(storageKey, value); } catch { /* sin almacenamiento */ } };
  return [period, setPeriod];
}

export const evolutionTitle = period => period === 'mes' ? 'Evolución mensual' : 'Evolución diaria';

export function EvolutionToggle({ period, onChange }) {
  return <div className="kpi-metric-choice kpi-period-choice" role="group" aria-label="Agrupar evolución">
    <span>Ver</span>
    <button type="button" className={period === 'dia' ? 'active' : ''} aria-pressed={period === 'dia'} onClick={() => onChange('dia')}>Diaria</button>
    <button type="button" className={period === 'mes' ? 'active' : ''} aria-pressed={period === 'mes'} onClick={() => onChange('mes')}>Mensual</button>
  </div>;
}

export function EvolutionChart({ dias, period, countKey = 'cantidad', countName, amountName = 'Importe', colors }) {
  const monthly = period === 'mes';
  const rows = monthly ? byMonth(dias, countKey) : dias;
  const label = monthly ? monthLabel : dayLabel;
  return <div className="kpi-chart wide"><ResponsiveContainer width="100%" height="100%">
    <ComposedChart data={rows} margin={{ top: 14, right: 12, left: 4, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 5" vertical={false} stroke="#e8edf3" />
      <XAxis dataKey="fecha" tickFormatter={label} minTickGap={monthly ? 4 : 18} interval={monthly && rows.length <= 13 ? 0 : 'preserveEnd'} tick={monthly ? { fontSize: 11 } : undefined} />
      <YAxis yAxisId="count" allowDecimals={false} width={35} />
      <YAxis yAxisId="amount" orientation="right" tickFormatter={formatInteger} width={75} />
      <Tooltip labelFormatter={label} formatter={(value, name) => name === amountName ? formatMoney(value) : formatInteger(value)} />
      <Legend />
      <Bar yAxisId="count" dataKey={countKey} name={countName} fill={colors[0]} radius={[5, 5, 0, 0]} maxBarSize={monthly ? 48 : 26} />
      <Line yAxisId="amount" type={monthly ? 'linear' : 'monotone'} dataKey="monto" name={amountName} stroke={colors[1]} strokeWidth={3} dot={monthly} activeDot={{ r: 5 }} />
    </ComposedChart>
  </ResponsiveContainer></div>;
}
