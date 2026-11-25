import { AGENTE_URL, useTerminal } from './terminal.js';

// Indicador en el encabezado: en qué PC se está usando el sistema y a qué impresora salen los tickets.
export default function TerminalChip() {
  const { listo, agente, terminal } = useTerminal();
  if (!listo) return null;
  if (!agente) return <span className="terminal-chip is-off" title="Sin agente de impresión: los tickets se abren en el navegador">🖨 Navegador</span>;
  const impresora = terminal?.activo ? terminal.nombre_impresora : null;
  const titulo = `PC ${agente.equipo}${impresora ? ` · imprime en ${impresora} (${terminal.tamano_ticket} mm)` : ' · sin impresora asignada'}${agente.cola?.errores ? ` · ${agente.cola.errores} tickets con error en la cola` : ''}`;
  return <a className={`terminal-chip${impresora ? '' : ' is-warn'}`} href={`${AGENTE_URL}/`} target="_blank" rel="noopener noreferrer" title={titulo}>
    🖨 {terminal?.nombre || agente.equipo}{impresora ? ` · ${impresora}` : ' · sin impresora'}
  </a>;
}
