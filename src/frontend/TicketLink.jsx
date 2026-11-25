import { forwardRef } from 'react';
import { useOperationFeedback } from './OperationFeedback.jsx';
import { imprimirEnAgente, imprimirPedidoEnAgente, nombreDocumento, pedidoDelTicket, puedeImprimirDirecto, urlConTerminal, useTerminal } from './terminal.js';

// Botón/enlace de ticket: si esta PC tiene el agente de impresión y una impresora asignada,
// manda el ticket directo a esa impresora; si no, abre el PDF en otra pestaña (con el papel de esta PC).
// El ticket de pedido lleva detrás la comanda, si está activada: con agente como otro trabajo (corta entre los dos),
// en el navegador como segunda página.
// Acepta ref para poder dejarle el foco (por ejemplo, IMPRIMIR por defecto en el aviso de pedido cobrado).
const TicketLink = forwardRef(function TicketLink({ href, onClick, children, ...props }, ref) {
  const feedback = useOperationFeedback();
  const terminal = useTerminal();
  const pedidoId = pedidoDelTicket(href);
  const url = urlConTerminal(pedidoId ? `${href}?impresion=1` : href);

  const click = event => {
    onClick?.(event);
    if (!puedeImprimirDirecto() || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const impresora = terminal.terminal.nombre_impresora;
    const id = feedback.begin(`Enviando a ${impresora}…`);
    const envio = pedidoId ? imprimirPedidoEnAgente(pedidoId, impresora) : imprimirEnAgente(href, nombreDocumento(href));
    envio
      .then(enviados => feedback.succeed(id, enviados.length > 1 ? `Pedido y comanda enviados a ${impresora}.` : `Ticket enviado a ${impresora}.`))
      .catch(cause => {
        // Ya salió el pedido: se ofrece imprimir solo lo que falta, para no repetirlo.
        if (cause.enviados) feedback.fail(id, `El pedido ya se envió, pero la comanda no: ${cause.message}`, { printUrl: cause.pendiente.url, printLabel: 'IMPRIMIR SOLO COMANDA' });
        else feedback.fail(id, `${cause.message} Podés abrir el PDF con Ctrl+clic en Imprimir.`);
      });
  };

  return <a ref={ref} href={url} target="_blank" rel="noopener noreferrer" onClick={click} {...props}>{children}</a>;
});

export default TicketLink;
