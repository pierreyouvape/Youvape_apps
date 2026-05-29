// Gestion de l'ordre custom des vues SAV (drag & drop dans la sidebar).
// Stocké en localStorage par utilisateur du navigateur.

export const VIEWS_ORDER_KEY = 'yv.tickets.views.order';

export function loadViewsOrder() {
  try { return JSON.parse(localStorage.getItem(VIEWS_ORDER_KEY)) || []; }
  catch { return []; }
}

export function saveViewsOrder(ids) {
  localStorage.setItem(VIEWS_ORDER_KEY, JSON.stringify(ids));
}

// Réordonne les vues selon l'ordre utilisateur ; les nouvelles vues
// (pas encore dans l'ordre local) sont mises à la fin.
export function applyViewsOrder(views, order) {
  if (!order?.length) return views;
  const indexed = Object.fromEntries(views.map(v => [v.id, v]));
  const sorted = order.filter(id => indexed[id]).map(id => indexed[id]);
  const rest = views.filter(v => !order.includes(v.id));
  return [...sorted, ...rest];
}
