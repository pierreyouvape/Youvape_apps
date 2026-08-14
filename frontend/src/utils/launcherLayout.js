import { APP_GROUPS } from '../components/AppIcons';

/**
 * Outils partagés par l'accueil (tuiles) et la sidebar (liste) pour afficher
 * les apps groupées en « piles ».
 *
 * Une pile est purement une vue : les permissions, les routes et l'ordre
 * enregistré (`prefs.appOrder`) restent exprimés en clés d'app. Une pile prend
 * la position de son PREMIER membre accessible dans l'ordre courant, et les
 * autres membres disparaissent de la liste de premier niveau.
 */

const GROUP_BY_MEMBER = APP_GROUPS.reduce((m, g) => {
  g.members.forEach(k => { m[k] = g; });
  return m;
}, {});

export function groupOfApp(appKey) {
  return GROUP_BY_MEMBER[appKey] || null;
}

/**
 * Construit les éléments de premier niveau à afficher.
 * @param {Array} orderedApps  entrées APPS dans l'ordre de l'utilisateur
 * @param {Array<string>} accessibleKeys  clés d'app autorisées en lecture
 * @returns {Array<{type:'app'|'group', key:string, app?, group?, apps?}>}
 */
export function buildLauncherItems(orderedApps, accessibleKeys) {
  const allowed = new Set(accessibleKeys);
  const items = [];
  const placed = new Set();

  orderedApps.forEach(app => {
    if (!allowed.has(app.key)) return;
    const group = GROUP_BY_MEMBER[app.key];
    if (!group) {
      items.push({ type: 'app', key: app.key, app });
      return;
    }
    if (placed.has(group.key)) return;
    placed.add(group.key);
    const members = orderedApps.filter(a => group.members.includes(a.key) && allowed.has(a.key));
    items.push({ type: 'group', key: group.key, group, apps: members });
  });

  return items;
}

/**
 * Reconvertit un ordre d'éléments affichés (qui contient des clés de pile) en
 * ordre d'apps stockable dans les préférences. Les apps non affichées (droits
 * manquants) sont conservées à la fin pour ne pas être perdues.
 */
export function expandItemOrder(itemKeys, items, fullAppOrder = []) {
  const byKey = items.reduce((m, it) => { m[it.key] = it; return m; }, {});
  const expanded = [];
  itemKeys.forEach(k => {
    const it = byKey[k];
    if (!it) return;
    if (it.type === 'group') it.apps.forEach(a => expanded.push(a.key));
    else expanded.push(it.key);
  });
  const seen = new Set(expanded);
  fullAppOrder.forEach(k => { if (!seen.has(k)) { expanded.push(k); seen.add(k); } });
  return expanded;
}
