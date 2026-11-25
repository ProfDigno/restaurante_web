import { useSyncExternalStore } from 'react';

// Devuelve '' (PC o celular), 'chica' (7": cuadros uno debajo del otro) o 'grande' (dos columnas).
// Se mide la pantalla y no la página: con "Sitio de escritorio" Chrome agranda la página a 980 px,
// y el user agent no sirve (el iPad dice ser Mac, una tablet de 7" puede decir "Mobile").
// - 7": lado corto de 600 a 719 px, o de 480 a 599 con proporción de tablet (los celulares son más alargados).
// - Fuera de Android/iPad, el lado largo (hasta 1600 px) descarta los monitores táctiles grandes.
// - En pantalla dividida angosta se usa el diseño de celular.
const touch = window.matchMedia('(pointer: coarse)');

function tabletType() {
  const { width, height } = window.screen;
  const short = Math.min(width, height), long = Math.max(width, height);
  if (short < 480 || (short < 600 && long / short > 1.8)) return '';
  const type = short < 720 ? 'chica' : 'grande';
  if (!window.matchMedia(`(min-width: ${type === 'chica' ? 480 : 600}px)`).matches) return '';
  const ua = navigator.userAgent;
  // Se mantienen como tablet aunque tengan teclado o mouse conectado.
  if (/Android|iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return type;
  return touch.matches && long <= 1600 ? type : '';
}

function subscribe(notify) {
  touch.addEventListener('change', notify);
  window.addEventListener('resize', notify);
  return () => {
    touch.removeEventListener('change', notify);
    window.removeEventListener('resize', notify);
  };
}

export default function useTablet() {
  return useSyncExternalStore(subscribe, tabletType);
}
