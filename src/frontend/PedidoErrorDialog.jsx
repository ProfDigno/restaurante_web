import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function PedidoErrorDialog({ message, onAccept }) {
  const acceptButton = useRef(null);

  useEffect(() => {
    if (!message) return;
    const previousFocus = document.activeElement;
    acceptButton.current?.focus();
    return () => previousFocus?.focus?.();
  }, [message]);

  if (!message) return null;

  return createPortal(
    <div className="pedido-error-backdrop">
      <div
        className="pedido-error-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pedido-error-title"
        aria-describedby="pedido-error-message"
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault();
            acceptButton.current?.focus();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onAccept();
          }
        }}
      >
        <div className="pedido-error-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.3 3.9 2.1 18.1a1.8 1.8 0 0 0 1.6 2.7h16.6a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v5" />
            <circle cx="12" cy="17.5" r=".8" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <p className="pedido-error-eyebrow">ATENCIÓN</p>
        <h2 id="pedido-error-title">No se pudo completar la operación</h2>
        <p id="pedido-error-message">{message}</p>
        <button ref={acceptButton} type="button" className="primary pedido-error-accept" onClick={onAccept}>Aceptar</button>
      </div>
    </div>,
    document.body
  );
}
