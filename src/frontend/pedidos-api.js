export async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
  return data;
}
// crypto.randomUUID solo existe en contextos seguros (HTTPS o localhost); desde el celular por http://IP no está disponible.
function newKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function mutate(url, body = {}, method = 'POST') {
  const signature = JSON.stringify([url, method, body]);
  const storageKey = 'restaurante-operacion-pendiente';
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* No pending operation. */ }
  const clave = pending?.signature === signature ? pending.clave : newKey();
  sessionStorage.setItem(storageKey, JSON.stringify({ signature, clave }));
  const result = await api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clave }) });
  sessionStorage.removeItem(storageKey);
  return result;
}
export const stateName = state => ({en_preparacion:'COCINA',listo:'TERMINADO',cancelado:'ANULADO',abierto:'BORRADOR',confirmado:'CONFIRMADO',pagado:'PAGADO',entregado:'ENTREGADO'}[state] || state);
