// Importe entero en letras, en mayúsculas, para el "total en letras" de la factura (ej.: 125000 → "CIENTO VEINTICINCO MIL").
const UNIDADES = ['', 'UN', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE', 'DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE',
  'QUINCE', 'DIECISÉIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE', 'VEINTE', 'VEINTIUN', 'VEINTIDÓS', 'VEINTITRÉS', 'VEINTICUATRO',
  'VEINTICINCO', 'VEINTISÉIS', 'VEINTISIETE', 'VEINTIOCHO', 'VEINTINUEVE'];
const DECENAS = ['', '', '', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA'];
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS'];

function hasta999(n) {
  if (n === 100) return 'CIEN';
  const centena = CENTENAS[Math.floor(n / 100)];
  const resto = n % 100;
  let decena = '';
  if (resto < 30) decena = UNIDADES[resto];
  else decena = DECENAS[Math.floor(resto / 10)] + (resto % 10 ? ` Y ${UNIDADES[resto % 10]}` : '');
  return [centena, decena].filter(Boolean).join(' ');
}

function hasta999999(n) {
  const miles = Math.floor(n / 1000);
  const resto = n % 1000;
  const parteMiles = miles === 0 ? '' : miles === 1 ? 'MIL' : `${hasta999(miles)} MIL`;
  return [parteMiles, hasta999(resto)].filter(Boolean).join(' ');
}

export function numeroALetras(valor) {
  const n = Math.round(Math.abs(Number(valor) || 0));
  if (n === 0) return 'CERO';
  const millones = Math.floor(n / 1e6);
  const resto = n % 1e6;
  const parteMillones = millones === 0 ? '' : millones === 1 ? 'UN MILLÓN' : `${hasta999999(millones)} MILLONES`;
  return [parteMillones, hasta999999(resto)].filter(Boolean).join(' ');
}
