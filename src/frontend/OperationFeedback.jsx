import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  const fail = useCallback((id, message) => {
    setFeedback((current) => current?.id === id ? { id, phase: 'error', message } : current);
  }, []);
  const dismiss = useCallback(() => {
    setFeedback((current) => current?.phase === 'loading' ? current : null);
  }, []);

  useEffect(() => {
    if (!feedback || feedback.phase === 'loading') return;
    const timer = window.setTimeout(() => {
      setFeedback((current) => current?.id === feedback.id && current.phase !== 'loading' ? null : current);
    }, feedback.timeoutMs ?? 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return <FeedbackContext.Provider value={{ begin, succeed, fail }}>
    {children}
    <OperationFeedbackDialog feedback={feedback} onDismiss={dismiss} />
  </FeedbackContext.Provider>;
}

export function useOperationFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('OperationFeedbackProvider no está disponible');
  return feedback;
}

function OperationFeedbackDialog({ feedback, onDismiss }) {
  const dialogRef = useRef(null);
  const acceptRef = useRef(null);
  const printRef = useRef(null);
  const previousFocus = useRef(null);
  const visible = Boolean(feedback);

  useEffect(() => {
    if (!visible) return;
    previousFocus.current = document.activeElement;
    return () => {
      previousFocus.current?.focus?.();
      previousFocus.current = null;
    };
  }, [visible]);

  useEffect(() => {
    if (!feedback) return;
    if (feedback.phase === 'loading') dialogRef.current?.focus();
    else acceptRef.current?.focus();
  }, [feedback]);

  if (!feedback) return null;

  const { phase, message } = feedback;
  const loading = phase === 'loading';
  const title = loading ? 'Procesando…' : phase === 'success' ? 'Operación correcta' : 'No se pudo completar';

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
        if (event.key === 'Tab' && feedback.printUrl && !loading) {
          if (event.shiftKey && document.activeElement === acceptRef.current) {
            event.preventDefault();
            printRef.current?.focus();
          } else if (!event.shiftKey && document.activeElement === printRef.current) {
            event.preventDefault();
            acceptRef.current?.focus();
          }
        } else if (event.key === 'Tab') {
          event.preventDefault();
          (loading ? dialogRef : acceptRef).current?.focus();
        }
        if (event.key === 'Escape' && !loading) {
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
      {!loading && <div className="operation-feedback-actions">
        <button ref={acceptRef} type="button" className="primary operation-feedback-accept" onClick={onDismiss}>ACEPTAR</button>
        {feedback.printUrl && <a ref={printRef} className="secondary operation-feedback-print" href={feedback.printUrl} target="_blank" rel="noopener noreferrer" onClick={onDismiss}>IMPRIMIR</a>}
      </div>}
    </div>
  </div>, document.body);
}
