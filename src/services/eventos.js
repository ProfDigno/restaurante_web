import { EventEmitter } from 'node:events';

// Avisos dentro del proceso: alguien guardó un cambio que puede afectar la comanda.
// Solo avisan "algo cambió"; cada pantalla vuelve a pedir sus datos con la consulta de siempre.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function avisarCambio() { bus.emit('cambio'); }

export function alCambiar(listener) {
  bus.on('cambio', listener);
  return () => bus.off('cambio', listener);
}
