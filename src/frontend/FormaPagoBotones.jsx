// Selector horizontal de forma de pago: la marcada como por defecto va primero y preseleccionada.
export const defaultFormId = forms => String((forms.find(item => item.es_default) || forms[0])?.idforma_pago ?? '');
const ordered = forms => [...forms].sort((a, b) => Number(!!b.es_default) - Number(!!a.es_default));
export default function FormaPagoBotones({ forms, value, onChange, disabled = false, noneLabel = '' }) {
  const current = String(value ?? '');
  return <div className="payment-buttons" role="radiogroup" aria-label="Forma de pago">
    {noneLabel && <button type="button" role="radio" aria-checked={current === ''} className={current === '' ? 'active' : ''} disabled={disabled} onClick={() => onChange('')}>{noneLabel}</button>}
    {ordered(forms).map(form => <button type="button" role="radio" key={form.idforma_pago} aria-checked={current === String(form.idforma_pago)} className={current === String(form.idforma_pago) ? 'active' : ''} disabled={disabled} onClick={() => onChange(String(form.idforma_pago))}>{form.nombre}</button>)}
  </div>;
}
