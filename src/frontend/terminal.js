import { useEffect, useState } from 'react';
import { api } from './pedidos-api.js';

// Terminal = la PC donde se usa el sistema. La detecta el agente de impresión instalado en esa PC
// (http://127.0.0.1:9123), que informa el nombre de Windows y sus impresoras; el servidor devuelve
// la impresora, el papel (58/80 mm) y los saltos asignados a esa PC.
export const AGENTE_URL = 'http://127.0.0.1:9123';

let estado = { listo: false, agente: null, terminal: null };
let detectando = null;
const oyentes = new Set();
const avisar = () => oyentes.forEach(fn => fn(estado));

async function consultarAgente() {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 2000);
  try {
    const r = await fetch(`${AGENTE_URL}/estado`, { signal: control.signal });
    const data = await r.json();
    return r.ok && data.agente === 'restaurante-web' ? data : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

export function detectarTerminal(forzar = false) {
  if (detectando && !forzar) return detectando;
  detectando = (async () => {
    const agente = await consultarAgente();
    let terminal = null;
    if (agente) {
      terminal = await api('/api/terminales/registrar', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ equipo: agente.equipo, impresoras: agente.impresoras, version: agente.version }) }).catch(() => null);
    }
    estado = { listo: true, agente, terminal };
    avisar();
    return estado;
  })();
  return detectando;
}

export function useTerminal() {
  const [valor, setValor] = useState(estado);
  useEffect(() => {
    oyentes.add(setValor);
    if (!detectando) detectarTerminal();
    return () => oyentes.delete(setValor);
  }, []);
  return valor;
}

export const terminalActual = () => estado;

// Agrega ?terminal=ID para que el servidor arme el ticket con el papel de esta PC.
export function urlConTerminal(url) {
  const id = estado.terminal?.activo ? estado.terminal.idterminal : null;
  if (!id) return url;
  return `${url}${url.includes('?') ? '&' : '?'}terminal=${id}`;
}

// La impresión directa corre si el agente responde y la PC tiene impresora asignada.
export const puedeImprimirDirecto = () => Boolean(estado.agente && estado.terminal?.activo && estado.terminal?.nombre_impresora);

async function bajarPdf(url) {
  const pdf = await fetch(urlConTerminal(url));
  if (!pdf.ok) {
    let mensaje = 'No se pudo generar el ticket';
    try { mensaje = (await pdf.json()).error || mensaje; } catch { /* respuesta sin JSON */ }
    throw new Error(mensaje);
  }
  return pdf.blob();
}

async function encolarEnAgente(pdf, documento, impresora) {
  const params = new URLSearchParams({ documento: documento || 'Ticket' });
  if (impresora) params.set('impresora', impresora);
  let r;
  try {
    r = await fetch(`${AGENTE_URL}/imprimir?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  } catch {
    throw new Error('El agente de impresión de esta PC no responde. Revisá que esté abierto (ícono junto al reloj).');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'El agente no pudo recibir el ticket');
  return data;
}

// Baja el PDF del servidor y lo deja en la cola del agente. Devuelve el trabajo creado.
export async function imprimirEnAgente(url, documento, impresora = estado.terminal?.nombre_impresora) {
  return encolarEnAgente(await bajarPdf(url), documento, impresora);
}

// Número de pedido si la URL es la de su ticket; null para los demás tickets.
export const pedidoDelTicket = url => /^\/api\/pedidos\/(\d+)\/ticket\.pdf$/.exec(url)?.[1] ?? null;

// Pedido y comanda: un trabajo por ticket, en orden, para que la impresora corte entre los dos.
// Se bajan todos antes de mandar el primero. Devuelve los documentos enviados; si falla uno del medio,
// el error dice cuáles salieron (enviados) y cuál falta (pendiente).
export async function imprimirPedidoEnAgente(id, impresora = estado.terminal?.nombre_impresora) {
  const ticket = `/api/pedidos/${id}/ticket.pdf`;
  let documentos = [{ url: ticket, nombre: nombreDocumento(ticket) }];
  const respuesta = await fetch(urlConTerminal(`/api/pedidos/${id}/impresion`));
  // Un servidor sin reiniciar no tiene esta ruta y responde la página: se imprime solo el pedido.
  if (respuesta.headers.get('content-type')?.includes('application/json')) {
    const data = await respuesta.json();
    if (!respuesta.ok) throw new Error(data.error || 'No se pudo preparar la impresión');
    documentos = data.documentos;
  }
  const pdfs = await Promise.all(documentos.map(documento => bajarPdf(documento.url)));
  for (let i = 0; i < documentos.length; i += 1) {
    try {
      await encolarEnAgente(pdfs[i], documentos[i].nombre, impresora);
    } catch (cause) {
      if (i > 0) Object.assign(cause, { enviados: documentos.slice(0, i), pendiente: documentos[i] });
      throw cause;
    }
  }
  return documentos;
}

// Nombre legible del documento a partir de la URL del ticket ("/api/pedidos/5/ticket.pdf" → "Pedido #5").
export function nombreDocumento(url) {
  const tipos = { pedidos: 'Pedido', cajas: 'Cierre de caja', gastos: 'Gasto', compras: 'Compra', vales: 'Vale', 'pagos-delivery': 'Pago a delivery' };
  const m = /\/api\/([^/]+)\/(?:(?:historial|cuentas)\/)?(\d+)\//.exec(url);
  if (!m) return 'Ticket';
  if (url.includes('/comanda.pdf')) return `Comanda #${m[2]}`;
  return m[1] === 'mesas' ? `Cuenta de mesa #${m[2]}` : `${tipos[m[1]] || 'Ticket'} #${m[2]}`;
}

// Factura pre-impresa: va a la impresora de factura de esta PC (la segunda impresora de Terminales).
export const impresoraFactura = () => (estado.agente && estado.terminal?.activo && estado.terminal?.impresora_factura) || null;

// Manda la hoja con el triplicado a la impresora de factura; sin agente o sin impresora asignada abre el PDF.
// Devuelve el nombre de la impresora usada, o null si se abrió en el navegador.
export async function imprimirFactura(idfactura, documento = `Factura #${idfactura}`) {
  const url = `/api/facturas/${idfactura}/preimpresa.pdf`;
  const impresora = impresoraFactura();
  if (!impresora) {
    window.open(url, '_blank', 'noopener');
    return null;
  }
  await encolarEnAgente(await bajarPdf(url), documento, impresora);
  return impresora;
}
