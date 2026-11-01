export function normalizeMoneyValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function formatMoneyInput(value) {
  return normalizeMoneyValue(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function caretAfterDigits(formatted, digitCount) {
  if (digitCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < formatted.length; index += 1) {
    if (/\d/.test(formatted[index]) && ++seen === digitCount) return index + 1;
  }
  return formatted.length;
}

export function moneyValidity(value, min, max) {
  const digits = normalizeMoneyValue(value);
  if (!digits) return '';
  const amount = Number(digits);
  if (!Number.isSafeInteger(amount)) return 'Ingresá un importe entero válido.';
  if (min !== undefined && amount < Number(min)) return `El importe mínimo es ${formatMoneyInput(min)}.`;
  if (max !== undefined && amount > Number(max)) return `El importe máximo es ${formatMoneyInput(max)}.`;
  return '';
}
