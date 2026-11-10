/**
 * Catalogue caisse — règles pures (testées : tests/catalogSync.test.js).
 *
 * Le doublon qu'on chasse : le même article déjà dans la caisse sous un autre
 * nom et SANS le code-barres du site (« FRAISE KIWI 10ML - FRUIZEE » contre
 * « Fruizee Fraise Kiwi 10ml »). Deux parfums d'une même gamme ne sont pas des
 * doublons : ils diffèrent d'un mot sur quatre, d'où un seuil haut.
 */

const STOP = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'pour', 'par', 'avec', 'sans',
  'cigarette', 'electronique', 'e', 'liquide', 'eliquide', 'liquid', 'eliquid',
]);

const normalize = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&amp;/g, ' ')
  .replace(/(\d+(?:[.,]\d+)?)\s*(ml|mg|w|mah|k|cl|l|ohm)\b/g, (_, n, u) => `${n.replace(',', '.')}${u}`)
  .replace(/[^a-z0-9.]+/g, ' ')
  .trim();

const tokens = (s) => new Set(normalize(s).split(/\s+/).filter((t) => t && !STOP.has(t) && t !== '.'));

/** Contenances / dosages (10ml, 20mg, 3000mah…) : deux contenances différentes = deux articles. */
const sizeTokens = (set) => new Set([...set].filter((t) => /^\d+(\.\d+)?(ml|mg|w|mah|k|cl|l|ohm)$/.test(t)));

/**
 * Ressemblance 0..1 entre un produit du site et une fiche caisse. Jaccard sur
 * les mots, divisé par deux si les contenances se contredisent, et réduit si la
 * marque du site n'apparaît pas côté caisse (nom ou marque).
 */
const similarity = (site, nx) => {
  const a = site._n || tokens(site.name);
  const b = nx._b || tokens(`${nx.name} ${nx.brand || ''}`);
  if (!a.size || !b.size) return 0;
  // La marque de la caisse est souvent recopiée dans le nom : on compare le nom du
  // site au nom + marque de la caisse, mais sans pénaliser la marque en trop.
  const bName = nx._n || tokens(nx.name);
  const inter = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...bName]).size;
  let score = inter / Math.max(union, 1);
  const sa = sizeTokens(a);
  const sb = sizeTokens(b);
  if (sa.size && sb.size && ![...sa].some((t) => sb.has(t))) score *= 0.5;
  const brand = tokens(site.brand);
  if (brand.size && ![...brand].every((t) => b.has(t))) score *= 0.6;
  return Math.round(Math.min(score, 1) * 100) / 100;
};

/**
 * Catalogue caisse prêt à comparer : mots pré-découpés + index mot → fiches,
 * pour n'examiner que les fiches qui partagent au moins un mot (hors contenances).
 */
const buildIndex = (nxList) => {
  const list = nxList.map((nx) => ({ ...nx, _n: tokens(nx.name), _b: tokens(`${nx.name} ${nx.brand || ''}`) }));
  const byToken = new Map();
  for (const nx of list) {
    for (const t of nx._b) {
      if (/^\d/.test(t)) continue;
      if (!byToken.has(t)) byToken.set(t, []);
      byToken.get(t).push(nx);
    }
  }
  return { list, byToken, add(nx) { const e = { ...nx, _n: tokens(nx.name), _b: tokens(`${nx.name} ${nx.brand || ''}`) }; list.push(e); for (const t of e._b) { if (!byToken.has(t)) byToken.set(t, []); byToken.get(t).push(e); } } };
};

/** Les fiches caisse les plus proches (score ≥ min), meilleures d'abord. `nx` : liste ou index. */
const closest = (site, nx, { min = 0.4, limit = 3 } = {}) => {
  let pool = nx;
  const s = { ...site, _n: tokens(site.name) };
  if (!Array.isArray(nx)) {
    const seen = new Set();
    pool = [];
    for (const t of s._n) for (const e of nx.byToken.get(t) || []) if (!seen.has(e)) { seen.add(e); pool.push(e); }
  }
  return pool
    .map((e) => ({ id: e.id, name: e.name, score: similarity(s, e) }))
    .filter((c) => c.score >= min)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
};

const DOUBLON_SCORE = 0.7;

/**
 * Catégorie caisse d'un produit du site, apprise sur les paires déjà reconnues
 * par code-barres. `stats` : [{ cat, sub, nx_category_id, n, tot }] (1re par (cat, sub)).
 * Sûre si ≥ 90 % des paires de la même (catégorie, sous-catégorie) et au moins 10.
 */
const pickCategory = (stats, cat, sub) => {
  const row = stats.find((s) => s.cat === cat && s.sub === sub) || null;
  if (!row) return { categoryId: null, sure: false };
  const share = Number(row.n) / Number(row.tot);
  return { categoryId: row.nx_category_id, sure: share >= 0.9 && Number(row.tot) >= 10, share };
};

/**
 * Prix : que faire pour une paire (produit du site, fiche caisse) ?
 *  - 'locked'  : « garder le prix caisse » choisi → rien
 *  - 'same'    : 1re comparaison, prix égaux → on retient le prix (plus rien à faire)
 *  - 'review'  : 1re comparaison, prix différents → liste à vérifier
 *  - 'push'    : le prix normal du site a changé depuis le dernier alignement → on envoie
 *  - 'none'    : rien n'a changé
 */
const priceDecision = ({ sitePrice, nxPrice, state }) => {
  const site = Number(sitePrice);
  if (!(site > 0)) return 'none';
  if (state?.price_locked) return 'locked';
  if (!state || state.price_pushed == null) {
    return Math.abs(Number(nxPrice) - site) < 0.005 ? 'same' : 'review';
  }
  return Math.abs(Number(state.price_pushed) - site) >= 0.005 ? 'push' : 'none';
};

/** Écart relatif caisse / site, en % (signe : caisse plus chère = positif). */
const priceGapPct = (sitePrice, nxPrice) => Math.round(((Number(nxPrice) - Number(sitePrice)) / Number(sitePrice)) * 1000) / 10;

module.exports = {
  normalize, tokens, similarity, closest, buildIndex, DOUBLON_SCORE, pickCategory, priceDecision, priceGapPct,
};
