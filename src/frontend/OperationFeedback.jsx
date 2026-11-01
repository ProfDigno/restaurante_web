import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import MoneyInput from './MoneyInput.jsx';
import { formatMoney } from './formatters.js';
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
  const hold = useCallback(() => {
    setFeedback((current) => current ? { ...current, hold: true } : current);
  }, []);
  const replace = useCallback((message, options = {}) => {
    setFeedback((current) => current ? { id: current.id, phase: 'success', message, ...options } : current);
  }, []);

  useEffect(() => {
    if (!feedback || feedback.phase === 'loading' || feedback.hold) return;
    const timer = window.setTimeout(() => {
      setFeedback((current) => current?.id === feedback.id && current.phase !== 'loading' && !current.hold ? null : current);
    }, feedback.timeoutMs ?? 2000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  return <FeedbackContext.Provider value={{ begin, succeed, fail }}>
    {children}
    <OperationFeedbackDialog feedback={feedback} onDismiss={dismiss} onHold={hold} onReplace={replace} />
  </FeedbackContext.Provider>;
}

export function useOperationFeedback() {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('OperationFeedbackProvider no está disponible');
  return feedback;
}

const FOCUSABLE = 'button:not([disabled]), a[href], select, input';

function OperationFeedbackDialog({ feedback, onDismiss, onHold, onReplace }) {
  const dialogRef = useRef(null);
  const acceptRef = useRef(null);
  const previousFocus = useRef(null);
  const [charging, setCharging] = useState(false);
  const [form, setForm] = useState('');
  const [amount, setAmount] = useState('');
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
    setCharging(false);
    setBusy(false);
    setError('');
  }, [feedbackId]);

  useEffect(() => {
    if (!feedback) return;
    if (feedback.phase === 'loading') dialogRef.current?.focus();
    else if (!charging) acceptRef.current?.focus();
  }, [feedback, charging]);

  if (!feedback) return null;

  const { phase, message } = feedback;
  const loading = phase === 'loading';
  const title = loading ? 'Procesando…' : phase === 'success' ? 'Operación correcta' : 'No se pudo completar';
  const maxAmount = Number(advance?.total || 0);
  const amountNumber = Number(amount || 0);
  const amountValid = amount !== '' && Number.isInteger(amountNumber) && amountNumber >= 1 && amountNumber <= maxAmount;

  const openCharge = () => {
    const cash = advance.formas.find((item) => item.nombre.toLocaleLowerCase() === 'efectivo');
    setForm(String(cash?.idforma_pago ?? advance.formas[0]?.idforma_pago ?? ''));
    setAmount(String(maxAmount));
    setError('');
    setCharging(true);
    onHold();
  };

  const charge = async (event) => {
    event.preventDefault();
    if (busy || !amountValid || !form) return;
    setBusy(true);
    setError('');
    try {
      await advance.onPay({ fk_idforma_pago: form, importe: amount });
      setCharging(false);
      setBusy(false);
      onReplace(`Cobro anticipado de ${formatMoney(amount)} registrado en el pedido #${advance.pedidoId}.`, { printUrl: feedback.printUrl, timeoutMs: 5000 });
    } catch (cause) {
      setError(cause.message);
      setBusy(false);
    }
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
      {!loading && charging && <form className="operation-feedback-charge" onSubmit={charge}>
        <label>Forma de pago
          <select value={form} disabled={busy} onChange={(event) => setForm(event.target.value)}>
            {advance.formas.map((item) => <option key={item.idforma_pago} value={item.idforma_pago}>{item.nombre}</option>)}
          </select>
        </label>
        <label>Monto ₲
          <MoneyInput autoFocus min={1} max={maxAmount} disabled={busy} value={amount} onValueChange={setAmount} />
        </label>
        <small>Máximo {formatMoney(maxAmount)}</small>
        {error && <div className="operation-feedback-charge-error" role="alert">{error}</div>}
        <div className="operation-feedback-actions">
          <button type="submit" className="primary operation-feedback-accept" disabled={busy || !amountValid || !form}>{busy ? 'COBRANDO…' : 'COBRAR'}</button>
          <button type="button" className="secondary operation-feedback-print" disabled={busy} onClick={() => { setCharging(false); setError(''); }}>CANCELAR</button>
        </div>
      </form>}
      {!loading && !charging && <div className="operation-feedback-actions">
        <button ref={acceptRef} type="button" className="primary operation-feedback-accept" onClick={onDismiss}>ACEPTAR</button>
        {advance && <button type="button" className="secondary operation-feedback-charge-button" onClick={openCharge}>COBRO ANTICIPADO</button>}
        {feedback.printUrl && <a className="secondary operation-feedback-print" href={feedback.printUrl} target="_blank" rel="noopener noreferrer" onClick={onDismiss}>IMPRIMIR</a>}
      </div>}
    </div>
  </div>, document.body);
}
