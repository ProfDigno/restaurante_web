export async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo completar la operación');
  return data;
}
export async function mutate(url, body = {}, method = 'POST') {
  const signature = JSON.stringify([url, method, body]);
  const storageKey = 'restaurante-operacion-pendiente';
  let pending;
  try { pending = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* No pending operation. */ }
  const clave = pending?.signature === signature ? pending.clave : crypto.randomUUID();
  sessionStorage.setItem(storageKey, JSON.stringify({ signature, clave }));
  const result = await api(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, clave }) });
  sessionStorage.removeItem(storageKey);
  return result;
}
export const stateName = state => ({en_preparacion:'COCINA',listo:'TERMINADO',cancelado:'ANULADO',abierto:'BORRADOR',confirmado:'CONFIRMADO',pagado:'PAGADO',entregado:'ENTREGADO'}[state] || state);
