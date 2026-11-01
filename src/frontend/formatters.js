const integerFormatter = new Intl.NumberFormat('es-PY', { maximumFractionDigits: 0 });
const moneyFormatter = new Intl.NumberFormat('es-PY', { style: 'currency', currency: 'PYG', maximumFractionDigits: 0 });

export const formatInteger = (value) => integerFormatter.format(Number(value || 0));
export const formatMoney = (value) => moneyFormatter.format(Number(value || 0));
