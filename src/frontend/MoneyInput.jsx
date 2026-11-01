import { useLayoutEffect, useRef } from 'react';
import { caretAfterDigits, formatMoneyInput, moneyValidity, normalizeMoneyValue } from './money-input.js';

export default function MoneyInput({ value, onValueChange, min, max, className = '', ...props }) {
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);
  const display = formatMoneyInput(value);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.setCustomValidity(moneyValidity(value, min, max));
    if (pendingCaret.current !== null && document.activeElement === input) {
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  }, [value, min, max]);

  const change = (event) => {
    const input = event.currentTarget;
    const text = input.value;
    const selectionStart = input.selectionStart ?? text.length;
    if (!/^[0-9.]*$/.test(text)) {
      input.value = display;
      input.setSelectionRange(Math.min(selectionStart, display.length), Math.min(selectionStart, display.length));
      return;
    }

    const digitsBeforeCaret = text.slice(0, selectionStart).replace(/\D/g, '').length;
    const raw = normalizeMoneyValue(text);
    const formatted = formatMoneyInput(raw);
    const caret = caretAfterDigits(formatted, digitsBeforeCaret);
    pendingCaret.current = caret;
    input.value = formatted;
    input.setSelectionRange(caret, caret);
    input.setCustomValidity(moneyValidity(raw, min, max));
    onValueChange(raw);
  };

  return <input
    {...props}
    ref={inputRef}
    type="text"
    inputMode="numeric"
    className={`money-input ${className}`.trim()}
    value={display}
    onChange={change}
  />;
}
