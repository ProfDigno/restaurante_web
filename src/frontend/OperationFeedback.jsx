import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatMoney } from './formatters.js';
import { defaultFormId } from './FormaPagoBotones.jsx';
import TicketLink from './TicketLink.jsx';
import { urlConTerminal } from './terminal.js';
import './operation-feedback.css';

const FeedbackContext = createContext(null);

export function OperationFeedbackProvider({ children }) {
  const [feedback, setFeedback] = useState(null);
  const nextId = useRef(0);

  const begin = useCallback((message) => {
    const id = ++nextId.current;
    setFeedback({ id, phase: 'loading', message });
    return id;
  }, []);
  const succeed = useCallback((id, message, options = {}) => {
    setFeedback((current) => current?.id === id ? { id, phase: 'success', message, ...options } : current);
  }, []);
  const fail = useCallback((id, message, options = {}) => {
    setFeedback((current) => current?.id === id ? { id, phase: 'error', message, ...options } : current);
  }, []);
  const dismiss = useCallback(() => {
    setFeedback((current) => current?.phase === 'loading' ? current : null);
  }, []);
  const hold = useCallback(() => {
    setFeedback((current) => current ? { ...current, hold: true } : current);
  }, []);
  const replace = useCallback((message, options = {}) => {
    setFeedback((current) => current ? { id: current.id, phase: 'success', message, ...options } : current);
  }, []);

  useEffect(() => {
    // Con botones de acción (cobro, facturar, imprimir) no se cierra solo: un clic tardío
    // caería sobre la pantalla de atrás (por ejemplo, agregando un producto al pedido nuevo).
    if (!feedback || feedback.phase === 'loading' || feedback.hold || feedback.advance || feedback.invoice || feedback.printUrl) return;
    const timer = window.setTimeout(() => {
      setFeedback((current) => current?.id === feedback.id && current.phase !== 'loading' && !current.hold ? null : current);
    }, feedback.timeoutMs ?? 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  // Confirmación propia del sistema (reemplaza window.confirm). Devuelve una promesa con true/false.
  const [question, setQuestion] = useState(null);
  const confirm = useCallback((options) => new Promise((resolve) => {
    setQuestion((current) => { current?.resolve(false); return { ...options, resolve }; });
  }), []);
  const answer = useCallback((value) => {
    setQuestion((current) => { current?.resolve(value); return null; });
  }, []);

  return <FeedbackContext.Provider value={{ begin, succeed, fail, confirm }}>
    {children}
    <OperationFeedbackDialog feedback={feedback} onDismiss={dismiss} onHold={hold} onReplace={replace} />
    <ConfirmDialog question={question} onAnswer={answer} />
  </FeedbackContext.Provider>;
}

function ConfirmDialog({ question, onAnswer }) {
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);
  const visible = Boolean(question);

  useEffect(() => {
    if (!visible) return;
    const previous = document.activeElement;
    cancelRef.current?.focus();
    return () => previous?.focus?.();
  }, [visible]);

  if (!question) return null;
  const { title, message, detail, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', tone = 'warning' } = question;

  return createPortal(<div className="operation-feedback-backdrop confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onAnswer(false); }}>
    <div
      ref={dialogRef}
      className={`operation-feedback-dialog confirm-dialog ${tone}`}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-message"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onAnswer(false); }
        if (event.key === 'Tab') {
          const items = [...dialogRef.current.querySelectorAll('button')];
          const first = items[0]; const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }}
    >
      <div className="operation-feedback-icon" aria-hidden="true">
        {tone === 'danger'
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M12 11v4" /><path d="M9.5 13.5 12 16l2.5-2.5" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h4" /></svg>}
      </div>
      <h2 id="confirm-dialog-title">{title}</h2>
      <p id="confirm-dialog-message">{message}</p>
      {detail && <p className="confirm-dialog-detail">{detail}</p>}
      <div className="operation-feedback-actions">
        <button ref={cancelRef} type="button" className="primary confirm-dialog-cancel" onClick={() => onAnswer(false)}>{cancelLabel}</button>
        <button type="button" className="secondary confirm-dialog-confirm" onClick={() => onAnswer(true)}>{confirmLabel}</button>
      </div>
    </div>
  </div>, document.body);
}

export function useOperationFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('OperationFeedbackProvider no está disponible');
  return feedback;
}

// Texto común para salir de un pedido que todavía no se guardó.
export function discardOrderQuestion(confirmLabel = 'Descartar y salir') {
  return {
    title: '¿Descartar el pedido en curso?',
    message: 'Hay productos o datos cargados en este pedido que todavía no se guardaron.',
    detail: 'Si salís ahora se pierden y el pedido no llega a cocina. Para conservarlo, volvé y tocá “Guardar pedido”.',
    cancelLabel: 'Seguir con el pedido',
    confirmLabel,
  };
}

const FOCUSABLE ='button:not([disabled]), a[href], select, input';

function OperationFeedbackDialog({ feedback, onDismiss, onHold, onReplace }) {
  const dialogRef = useRef(null);
  const acceptRef = useRef(null);
  const defaultPayRef = useRef(null);
  const printRef = useRef(null);
  const previousFocus = useRef(null);
  const [payingForm, setPayingForm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const visible = Boolean(feedback);
  const feedbackId = feedback?.id;
  const advance = feedback?.advance;

  useEffect(() => {
    if (!visible) return;
    previousFocus.current = document.activeElement;
    return () => {
      previousFocus.current?.focus?.();
      previousFocus.current = null;
    };
  }, [visible]);

  useEffect(() => {
    setPayingForm('');
    setBusy(false);
    setError('');
  }, [feedbackId]);

  // Con formas de pago, el foco queda en la forma por defecto (EFECTIVO); si hay ticket, en IMPRIMIR; si no, en ACEPTAR.
  // Así, al guardar un pedido: Enter cobra en efectivo y el segundo Enter imprime.
  useEffect(() => {
    if (!feedback) return;
    if (feedback.phase === 'loading') dialogRef.current?.focus();
    // En delivery se cobra al entregar: el foco va a PAGAR DESPUÉS.
    else if (feedback.advance?.esDelivery && feedback.advance?.formas?.length) acceptRef.current?.focus();
    else (defaultPayRef.current || printRef.current || acceptRef.current)?.focus();
  }, [feedback]);

  if (!feedback) return null;

  const { phase, message } = feedback;
  const loading = phase === 'loading';
  const title = loading ? 'Procesando…' : phase === 'success' ? 'Operación correcta' : 'No se pudo completar';
  const total = Number(advance?.total || 0);
  const forms = advance?.formas?.length ? [...advance.formas].sort((a, b) => Number(!!b.es_default) - Number(!!a.es_default)) : [];
  const defaultForm = forms.length ? defaultFormId(forms) : '';

  // Un clic en la forma de pago cobra el total del pedido (pago + movimiento de caja).
  const pay = async (formId) => {
    if (busy) return;
    setBusy(true);
    setPayingForm(formId);
    setError('');
    onHold();
    try {
      await advance.onPay({ fk_idforma_pago: formId, importe: String(total) });
      const formName = forms.find(f => String(f.idforma_pago) === formId)?.nombre || '';
      onReplace(`Pedido #${advance.pedidoId} cobrado: ${formatMoney(total)}${formName ? ` en ${formName}` : ''}.`, { printUrl: feedback.printUrl, invoice: feedback.invoice, timeoutMs: 5000 });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setBusy(false);
      setPayingForm('');
    }
  };

  // PAGAR DESPUÉS en delivery: mismo paso siguiente que tras cobrar (ACEPTAR / IMPRIMIR, foco en IMPRIMIR).
  const payLater = () => {
    if (advance?.esDelivery && feedback.printUrl) {
      onReplace(`Pedido #${advance.pedidoId} guardado. Se cobra ${formatMoney(total)} al entregar.`, { printUrl: feedback.printUrl, invoice: feedback.invoice, timeoutMs: 5000 });
    } else onDismiss();
  };

  const trapTab = (event) => {
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (!items.length) { event.preventDefault(); dialogRef.current.focus(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return createPortal(<div className="operation-feedback-backdrop">
    <div
      ref={dialogRef}
      className={`operation-feedback-dialog ${phase}`}
      role={loading ? 'dialog' : 'alertdialog'}
      aria-modal="true"
      aria-labelledby="operation-feedback-title"
      aria-describedby="operation-feedback-message"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Tab') trapTab(event);
        if (event.key === 'Escape' && !loading && !busy) {
          event.preventDefault();
          onDismiss();
        }
      }}
    >
      <div className="operation-feedback-icon" aria-hidden="true">
        {loading ? <span className="operation-feedback-spinner" /> : phase === 'success'
          ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4.5 4.5L19 7" /></svg>
          : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 2.1 18.1a1.8 1.8 0 0 0 1.6 2.7h16.6a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v5" /><circle cx="12" cy="17.5" r=".8" fill="currentColor" stroke="none" /></svg>}
      </div>
      <h2 id="operation-feedback-title">{title}</h2>
      <p id="operation-feedback-message" aria-live="polite">{message}</p>
      {!loading && forms.length > 0 && <div className="operation-feedback-pay">
        <span>Cobrar {formatMoney(total)} con:</span>
        <div className="operation-feedback-pay-buttons" role="group" aria-label="Forma de pago">
          {forms.map(f => { const fid = String(f.idforma_pago); return <button key={fid} ref={fid === defaultForm ? defaultPayRef : null} type="button" className={fid === defaultForm ? 'primary' : 'secondary'} disabled={busy} onClick={() => pay(fid)}>{payingForm === fid ? 'COBRANDO…' : f.nombre.toUpperCase()}</button>; })}
        </div>
        {error && <div className="operation-feedback-charge-error" role="alert">{error}</div>}
      </div>}
      {!loading && <div className="operation-feedback-actions">
        <button ref={acceptRef} type="button" className={`${forms.length || feedback.printUrl ? 'secondary' : 'primary'} operation-feedback-accept`} disabled={busy} onClick={forms.length ? payLater : onDismiss}>{forms.length ? 'PAGAR DESPUÉS' : 'ACEPTAR'}</button>
        {feedback.invoice && <button type="button" className="secondary operation-feedback-print" disabled={busy} onClick={() => { onDismiss(); feedback.invoice(); }}>FACTURAR</button>}
        {feedback.printUrl && <TicketLink ref={forms.length ? null : printRef} className={`${forms.length ? 'secondary' : 'primary'} operation-feedback-print`} href={feedback.printUrl} onClick={onDismiss}>{feedback.printLabel || 'IMPRIMIR'}</TicketLink>}
        {/* Vista previa: abre el PDF en otra pestaña sin mandarlo a la impresora. */}
        {feedback.printUrl && <a className="secondary operation-feedback-print" href={urlConTerminal(feedback.printUrl)} target="_blank" rel="noopener noreferrer" onClick={onDismiss}>VISTA PREVIA</a>}
      </div>}
    </div>
  </div>, document.body);
}
