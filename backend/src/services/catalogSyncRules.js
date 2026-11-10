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
    .map((e) => ({ id: e.id, name: e.name, score: similarity(s, e), same: isSameName(s, e) }))
    .filter((c) => c.same || c.score >= min)
    .sort((x, y) => Number(y.same) - Number(x.same) || y.score - x.score)
    .slice(0, limit);
};

const DOUBLON_SCORE = 0.7;

// Mots qui ne distinguent pas deux articles (« Kit Pod Kiwi 2 » = « KIT KIWI 2 »).
const NEUTRAL = new Set(['pod']);

/**
 * Même article sous un autre nom ? Il faut EXACTEMENT les mêmes mots, dans
 * n'importe quel ordre, hors marque (des deux côtés) et mots neutres. Un mot de
 * parfum, couleur, résistance ou dosage en plus ou en moins = un autre article
 * (simulation du 10/11/2026 : « Falcon Mini Strawberry Watermelon » n'est pas
 * « Falcon Mini Watermelon » ; « BOX AEGIS SOLO 5 - GEEKVAPE - RED » est bien
 * « Box Aegis Solo 5 - Red »).
 */
/** Mots d'un nom, AVEC répétitions (« Pack 2 … Feelin 2 » a deux « 2 »). */
const wordList = (s) => normalize(s).split(/\s+/).filter((t) => t && !STOP.has(t) && t !== '.');

/** Deux mots de marque qui se valent : égaux, ou une lettre d'écart (DILIGAF / Dilligaf, DLIC / Dlice). */
const lev1 = (a, b) => {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
};

/**
 * Marques compatibles : si la caisse a une marque, un de ses mots doit se
 * retrouver dans la marque ou la sous-marque du site (« LE M - LIQUIDEO » n'est
 * pas le « LE M » de Roykin ; « CUSTARD - DOTMOD » n'est pas le Custard de Don Cristo).
 */
const brandsMatch = (site, nx) => {
  const nb = [...tokens(nx.brand)];
  const sb = [...tokens(site.brand), ...tokens(site.sub_brand)];
  if (!nb.length || !sb.length) return true;
  // La marque de la caisse, ou la marque du site écrite dans le nom caisse.
  const inName = [...tokens(nx.name)];
  return [...nb, ...inName].some((t) => sb.some((u) => lev1(t, u)));
};

const isSameName = (site, nx) => {
  if (!brandsMatch(site, nx)) return false;
  const brand = [...tokens(site.brand), ...tokens(site.sub_brand), ...tokens(nx.brand)];
  const isBrand = (t) => brand.some((u) => lev1(t, u));
  const keep = (list) => list.filter((t) => !isBrand(t) && !NEUTRAL.has(t)).sort();
  const a = keep(wordList(site.name));
  const b = keep(wordList(nx.name));
  if (a.length < 2 || b.length < 2) return false;
  return a.length === b.length && a.every((t, i) => t === b[i]);
};

/**
 * Catégorie caisse d'un produit du site, apprise sur les paires déjà reconnues
 * par code-barres. `stats` : [{ cat, sub, nx_category_id, n, tot }] (1re par (cat, sub)).
 * Sûre si ≥ 90 % des paires de la même (catégorie, sous-catégorie) et au moins 10.
 */
const pickCategory = (stats, cat, sub) => {
  const row = stats.find((s) => s.cat === cat && s.sub === sub) || null;
  if (!row) return { categoryId: null, sure: false };
  const share = Number(row.n) / Number(row.tot);
  return { categoryId: row.nx_category_id, categoryName: row.nx_category_name || null, sure: share >= 0.9 && Number(row.tot) >= 10, share };
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

/**
 * Résistances : le site les vend en pack (« Pack 5 Résistances… »), les boutiques
 * à l'unité. Jamais créées depuis la fiche du site (prix et quantité faux en
 * caisse) — décision Maxime, 10/11/2026 : laissées de côté pour l'instant.
 */
// Pas les « Pack 10 Coils » (fils montés, vendus en pack aussi en boutique), ni les
// cartouches « à résistance intégrée » (vendues à la boîte).
const isResistance = (siteName, nxCategoryName) => String(nxCategoryName || '').toUpperCase() === 'RESISTANCES'
  || /^pack\s+\d+\s*x?\s*r[ée]sistances?\b/i.test(String(siteName || '').trim());

/** Écart relatif caisse / site, en % (signe : caisse plus chère = positif). */
const priceGapPct = (sitePrice, nxPrice) => Math.round(((Number(nxPrice) - Number(sitePrice)) / Number(sitePrice)) * 1000) / 10;

module.exports = {
  normalize, tokens, similarity, closest, buildIndex, isSameName, isResistance, DOUBLON_SCORE, pickCategory, priceDecision, priceGapPct,
};
