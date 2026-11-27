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
 * Sous-catégorie caisse d'une fiche créée par l'app (27/11/2026). Avant, aucune :
 * ~850 liquides rangés dans « E-LIQUIDES » seul, quand les fiches de l'équipe sont
 * toutes en « 10 ml », « 50 ml », « Salt »… La catégorie du site ne suffit pas
 * (« Grands Formats 50ml, 100ml, 200ml ») : on lit la contenance dans le nom.
 *  - E-LIQUIDES : sel de nicotine → Salt, CBD → CBD, sinon 10 / 50 (pack 60 ml
 *    compris) / 100 / 200 ml ;
 *  - AROMES : 10 / 20 / 30 / 60 ml ;
 *  - BOX ACCU / KIT ACCU : attribut WC « Types de batteries » (`p.battery`),
 *    Simple accu → 1 accu, Double accu → 2 accus (concordance totale sur les
 *    fiches de l'équipe, 27/11/2026).
 *  - CARTOUCHES : voir cartridgeKind.
 * Ailleurs, ou contenance sans sous-catégorie (170 ml) : null, la fiche reste sans.
 * `subcategories` : [{ id, category_id, name }] de Nextore ; `p` : { name, sub,
 * battery, coils_compatible, coil_value } du site, `nxName` : nom de la fiche caisse.
 */
const SUBCATEGORY_VOLUMES = {
  'E-LIQUIDES': { 10: '10 ml', 50: '50 ml', 60: '50 ml', 100: '100 ml', 200: '200 ml' },
  AROMES: { 10: '10 ml', 20: '20 ml', 30: '30 ml', 60: '60 ml' },
};
const subKey = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
// Valeur UNIQUE de l'attribut batterie (plusieurs valeurs = on ne tranche pas).
const batteryKind = (battery) => {
  const values = [...new Set(String(battery || '').split('|').map((v) => v.trim()).filter(Boolean))];
  if (values.length !== 1) return null;
  if (/int[ée]gr/i.test(values[0])) return 'integre';
  if (/^simple/i.test(values[0])) return 'simple';
  if (/^double/i.test(values[0])) return 'double';
  return null;
};
/**
 * Cartouches : « Cartouches Pré-remplies » du site → PREREMPLIE (88/88 chez l'équipe).
 * « Cartouches Pods » : Vide (résistance à part) ou Resistance (intégrée), lu dans
 * le nom puis dans les attributs WC — 72/75 justes sur les fiches de l'équipe
 * (27/11/2026). Rien de lisible (« Cartouche Meteorite ») : null, on ne devine pas.
 */
const cartridgeKind = (p) => {
  const sub = String(p?.sub || '');
  const name = String(p?.name || '');
  if (/pr[ée]-?rempli/i.test(sub)) return 'PREREMPLIE';
  if (!/^cartouches pods$/i.test(sub.trim())) return null;
  if (/\bvides?\b|interchangeable|\brba\b/i.test(name)) return 'Vide';
  if (/\d(?:[.,]\d+)?\s*(?:Ω|ohms?\b)/i.test(name) || /r[ée]sistances? int[ée]gr/i.test(name)) return 'Resistance';
  if (p?.coils_compatible) return 'Vide';
  if (p?.coil_value) return 'Resistance';
  return null;
};
// Attributs WC lus par pickSubcategory / refineCategoryName (alias p / pp = produit / parent).
const siteAttr = (attr, alias) => `(SELECT string_agg(DISTINCT a.value, '|') FROM wp_product_attributes a
           WHERE a.wp_product_id = COALESCE(pp.wp_product_id, p.wp_product_id) AND a.attribute = '${attr}') AS ${alias}`;
const SITE_ATTRS_SQL = [
  siteAttr('pa_types-de-batteries', 'battery'),
  siteAttr('pa_resistances-compatibles', 'coils_compatible'),
  siteAttr('pa_valeur-de-resistance', 'coil_value'),
].join(',\n         ');
const BATTERY_FAMILY = { 'BOX ACCU': 'BOX', 'BOX INTEGRE': 'BOX', 'KIT ACCU': 'KIT', 'KIT INTEGRE': 'KIT' };
/**
 * Catégorie caisse corrigée par l'attribut batterie : une box ou un kit à batterie
 * intégrée va en « BOX/KIT INTEGRE », à accus en « BOX/KIT ACCU » (Huracan LX,
 * Kiwi Power Bank créés en BOX ACCU). Ne change jamais de famille (box ↔ kit), ni
 * une autre catégorie. Renvoie le NOM de la catégorie (inchangé si rien à faire).
 */
const refineCategoryName = (categoryName, battery) => {
  const fam = BATTERY_FAMILY[String(categoryName || '').trim().toUpperCase()];
  const kind = batteryKind(battery);
  if (!fam || !kind) return categoryName;
  return `${fam} ${kind === 'integre' ? 'INTEGRE' : 'ACCU'}`;
};
const pickSubcategory = (p, { categoryId, categoryName, nxName = '' }, subcategories) => {
  const cat = String(categoryName || '').trim().toUpperCase();
  if (!categoryId) return null;
  const find = (label) => {
    const hit = label && (subcategories || []).find((s) => String(s.category_id) === String(categoryId) && subKey(s.name) === subKey(label));
    return hit ? String(hit.id) : null;
  };
  if (cat === 'BOX ACCU' || cat === 'KIT ACCU') {
    const kind = batteryKind(p?.battery);
    return find(kind === 'simple' ? '1 accu' : kind === 'double' ? '2 accus' : null);
  }
  if (cat === 'CARTOUCHES') return find(cartridgeKind(p));
  const volumes = SUBCATEGORY_VOLUMES[cat];
  if (!volumes) return null;
  const siteSub = String(p?.sub || '');
  let label = null;
  if (cat === 'E-LIQUIDES' && /sel de nicotine/i.test(siteSub)) label = 'Salt';
  else if (cat === 'E-LIQUIDES' && /\bcbd\b/i.test(siteSub)) label = 'CBD';
  else {
    // Le nom caisse d'abord (contenance normalisée « 60ML »), puis celui du site.
    const ml = [nxName, p?.name].map((t) => String(t || '').match(/(?:^|[^\d])(\d{2,3})\s?ml\b/i)).find(Boolean);
    if (ml) label = volumes[Number(ml[1])] || null;
    else if (/10\s?ml/i.test(siteSub)) label = volumes[10] || null;
  }
  return find(label);
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

/**
 * Marque à écrire sur une fiche caisse (champ Nextore `cf1`, texte libre). On
 * reprend l'orthographe d'une marque DÉJÀ dans Nextore si la sous-marque ou la
 * marque du site y correspond (« Cupide », « FRUITY FUEL », « Liquideo »), pour
 * ne pas créer « ASPIRE » à côté de « Aspire » ; sinon la sous-marque du site,
 * à défaut sa marque. `nxBrands` : marques Nextore existantes (texte).
 */
const pickBrand = (site, nxBrands) => {
  const key = (s) => normalize(s).replace(/[^a-z0-9]/g, '');
  const byKey = new Map();
  for (const b of nxBrands) {
    const k = key(b);
    if (k && !byKey.has(k)) byKey.set(k, b);
  }
  const keys = [...byKey.keys()];
  for (const cand of [site.sub_brand, site.brand]) {
    const k = key(cand);
    if (!k) continue;
    if (byKey.has(k)) return byKey.get(k);
    const near = keys.find((x) => lev1(x, k));
    if (near) return byKey.get(near);
  }
  return String(site.sub_brand || site.brand || '').trim() || null;
};

/** Écart relatif caisse / site, en % (signe : caisse plus chère = positif). */
const priceGapPct = (sitePrice, nxPrice) => Math.round(((Number(nxPrice) - Number(sitePrice)) / Number(sitePrice)) * 1000) / 10;

module.exports = {
  normalize, tokens, similarity, closest, buildIndex, isSameName, isResistance, pickBrand, DOUBLON_SCORE, pickCategory, pickSubcategory, refineCategoryName, cartridgeKind, SITE_ATTRS_SQL, priceDecision, priceGapPct,
};
