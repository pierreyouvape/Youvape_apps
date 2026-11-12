/**
 * Module « création de fiche produit » — rédaction par Claude à partir des
 * attributs saisis, de la Search Console, de Google Ads et des concurrents.
 *
 * Ne rédige que ce que yv-fiche-blocs ne sait pas construire depuis les
 * attributs : title et méta Yoast, H1, « Composition aromatique » (par
 * recette) et « La marque » (par marque). Le tableau, les autres formats,
 * « Comment utiliser » et les questions restent faits par l'extension.
 *
 * Étapes : dossier (fiche + formats de la recette + marque) → Search Console
 * → Google Ads (volumes + idées) → concurrents (recherche web de Claude) →
 * rédaction → contrôle automatique (mots interdits, longueurs) → vérification
 * des faits par une seconde lecture de Claude.
 *
 * Règle de rédaction (publicité vape, CSP L. 3513-4, litige DNF) : faits
 * objectifs seulement. Tout texte reste un brouillon, relu par Maxime et
 * l'avocat avant mise en ligne.
 */

const axios = require('axios');
const pool = require('../config/database');
const { BANNED } = require('./seoAdvisorService');
const ads = require('./googleAdsService');

const SITE = process.env.YVPW_SITE || 'https://www.youvape.fr';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.PRODUCT_WRITER_MODEL || 'claude-opus-5-5';
const GSC_DAYS = 90;
// Tarifs Opus 5.5 ($/million de tokens) pour estimer le coût d'une fiche.
const PRICE_IN = 4;
const PRICE_OUT = 20;
const WEB_SEARCH_PRICE = 0.01;

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const decode = (s) => (s || '')
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&').replace(/&rsquo;|&#8217;/g, '’').replace(/&nbsp;/g, ' ')
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const textOf = (html) => decode(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const words = (s) => textOf(s).split(' ').filter(Boolean).length;
const pathOf = (url) => String(url || '').replace(/^https?:\/\/(www\.)?youvape\.fr/, '') || '/';

/* ─── Dossier produit (WooCommerce, API publiques) ─────── */

const wpGet = async (path, params = {}) => {
  const res = await axios.get(`${SITE}/wp-json/${path}`, {
    params, headers: { 'User-Agent': USER_AGENT }, timeout: 30000,
  });
  return res.data;
};

const ORDER_FORMATS = { 'eliquides-10ml': 1, 'eliquides-grands-formats': 2, 'eliquides-sels-de-nicotine': 3, 'concentres-10ml': 4, 'concentres-grands-formats': 4, puffs: 5, 'cartouches-pre-remplies': 6 };

// Même logique que yvfb_nom_recette() de l'extension : « Concentré Red Astaire 30ml » → « red astaire ».
// Avec la marque, son nom est retiré aussi : « Fraise de Kiwi Vapor 10ml » → « fraise ».
// Noms de marque d'une fiche, la sous-marque d'abord : c'est elle que les gens cherchent dans 9 cas
// sur 10 (« Shigeri de Fighter Fuel », pas « Shigeri de Maison Fuel »).
const commercialName = (m) => m?.gamme?.nom || m?.nom || '';
const brandNames = (m) => [m?.gamme?.nom, m?.nom].filter(Boolean);
// Une même recette sous deux noms, le temps que le fabricant renomme ses produits : ancien nom → nom retenu.
const RECIPE_ALIASES = { 'love 66': 'luv 66' };
const recipeNames = (key) => [key, ...Object.keys(RECIPE_ALIASES).filter((a) => RECIPE_ALIASES[a] === key)];
const recipeKey = (name, brand) => {
  let n = norm(decode(name))
    .replace(/(^|\s)(concentres?|aromes?|e-?liquides?)(?=\s|$)/g, ' ')
    .replace(/(^|\s)(nic(otine)? ?salts?|sels? de nicotine|nicotine plus)(?=\s|$)/g, ' ')
    .replace(/\s+salts?\s*$/g, ' ') // « Strawberry Ice Salt » : Salt = le format sel de nicotine
    .replace(/\+? ?boosters?/g, ' ')
    .replace(/(^|\s)\d+ ?ml(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  // Gamme et marque mère : « Shigeri Fighter Fuel 100ml » → « shigeri », une fois le H1 appliqué.
  for (const one of [brand].flat().filter(Boolean)) {
    const b = norm(decode(one)).replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
    n = ` ${n.replace(/[-–]/g, ' ').replace(/\s+/g, ' ')} `.replace(` ${b} `, ' ')
      .replace(/\s(de|par|by)\s*$/, ' ').replace(/\s+/g, ' ').trim();
  }
  // Salt peut précéder la marque dans le H1 (« … Salt JNR 10ml ») : on le retire aussi une fois la marque partie.
  n = n.replace(/\s+salts?$/, '').trim();
  return RECIPE_ALIASES[n] || n;
};

// Marque racine (Perfect Brands) d'une liste de fiches publiées : id fiche → id de la marque racine.
const brandParent = new Map();
const rootBrandId = async (termId) => {
  let id = termId;
  for (let i = 0; i < 5 && id; i++) {
    if (!brandParent.has(id)) {
      const t = await wpGet(`wp/v2/pwb-brand/${id}`, { _fields: 'id,parent' }).catch(() => ({ parent: 0 }));
      brandParent.set(id, t.parent || 0);
    }
    if (!brandParent.get(id)) return id;
    id = brandParent.get(id);
  }
  return id;
};
const productBrands = async (ids) => {
  if (!ids.length) return new Map();
  const rows = await wpGet('wp/v2/product', { include: ids.join(','), per_page: 100, _fields: 'id,pwb-brand' });
  const out = new Map();
  for (const r of rows) {
    const roots = await Promise.all((r['pwb-brand'] || []).map(rootBrandId));
    out.set(r.id, new Set(roots));
  }
  return out;
};

// Variantes d'écriture d'un nom pour la Search Console : « t-juice » → t-juice, t juice, tjuice.
const variants = (s) => {
  const n = norm(decode(s || '')).trim();
  return n ? [...new Set([n, n.replace(/-/g, ' '), n.replace(/[-\s]/g, '')])] : [];
};

const attrsOf = (p) => Object.fromEntries((p.attributes || []).map((a) => [decode(a.name), a.terms.map((t) => decode(t.name))]));

const summarize = (p) => ({
  id: p.id,
  nom: decode(p.name),
  url: p.permalink,
  chemin: pathOf(p.permalink),
  categories: (p.categories || []).map((c) => c.slug),
  attributs: attrsOf(p),
  description_courte: textOf(p.short_description),
  description_longue: textOf(p.description),
});

const loadBrand = async (productId) => {
  const wp = await wpGet(`wp/v2/product/${productId}`, { _fields: 'id,pwb-brand' }).catch(() => null);
  const ids = wp?.['pwb-brand'] || [];
  if (!ids.length) return null;
  const terms = await wpGet('wp/v2/pwb-brand', { include: ids.join(','), _fields: 'id,name,slug,parent,link' });
  let term = terms.find((t) => t.parent) || terms[0]; // la gamme si la fiche en a une
  const chain = [term];
  while (term?.parent) {
    term = await wpGet(`wp/v2/pwb-brand/${term.parent}`, { _fields: 'id,name,slug,parent,link,description' });
    chain.unshift(term);
  }
  const root = chain[0];
  const full = await wpGet(`wp/v2/pwb-brand/${root.id}`, { _fields: 'id,name,slug,link,description' });
  return {
    id: root.id,
    nom: decode(root.name),
    chemin: pathOf(root.link),
    gamme: chain.length > 1 ? { id: chain[chain.length - 1].id, nom: decode(chain[chain.length - 1].name), chemin: pathOf(chain[chain.length - 1].link), catalogue: await loadBrandCatalog(chain[chain.length - 1].id) } : null,
    // Page marque actuelle : contexte seulement, elle n'est pas une source de faits (elle dit « britannique »).
    page_marque_extrait: textOf(full.description).slice(0, 1200),
    catalogue: await loadBrandCatalog(root.id),
  };
};

// Ce que la marque vend sur youvape.fr (catégories et quelques noms) : source du texte de marque.
const catNames = new Map();
const loadBrandCatalog = async (brandId) => {
  if (!brandId) return null;
  // Gammes (sous-marques) : un produit peut n'être rangé que dans sa gamme (puffs Fighter X : Fighter
  // Fuel seulement, pas Maison Fuel). Sans elles, le catalogue oubliait les puffs.
  const gammes = await wpGet('wp/v2/pwb-brand', { parent: brandId, per_page: 100, _fields: 'id,name,link,count' }).catch(() => []);
  const ids = [brandId, ...gammes.map((g) => g.id)];
  const rows = new Map();
  for (let page = 1; page <= 10; page++) {
    const batch = await wpGet('wp/v2/product', { 'pwb-brand': ids.join(','), per_page: 100, page, _fields: 'id,title,product_cat' }).catch(() => []);
    for (const r of batch) rows.set(r.id, r);
    if (batch.length < 100) break;
  }
  const list = [...rows.values()];
  const missing = [...new Set(list.flatMap((r) => r.product_cat || []))].filter((id) => !catNames.has(id));
  if (missing.length) {
    const cats = await wpGet('wp/v2/product_cat', { include: missing.join(','), per_page: 100, _fields: 'id,name' }).catch(() => []);
    for (const c of cats) catNames.set(c.id, decode(c.name));
  }
  const byCat = {};
  for (const r of list) {
    const cat = (r.product_cat || []).map((id) => catNames.get(id)).filter(Boolean).join(' / ') || 'autre';
    (byCat[cat] = byCat[cat] || []).push(decode(r.title?.rendered || ''));
  }
  return {
    nombre_de_produits: list.length,
    par_categorie: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, { nombre: v.length, exemples: v.slice(0, 6) }])),
    gammes: gammes.filter((g) => g.count > 0).map((g) => ({ nom: decode(g.name), chemin: pathOf(g.link), produits: g.count })),
  };
};

// Autres formats de la recette : même nom de recette ET même marque. Sans le
// contrôle de la marque, « Fraise » ramènerait les fraises de toutes les marques.
const loadFormats = async (product, key, marque) => {
  const searches = recipeNames(key).flatMap((k) => [k, ...brandNames(marque).map((b) => `${k} ${b}`)]);
  const found = new Map();
  for (const search of searches) {
    for (const p of await wpGet('wc/store/v1/products', { search, per_page: 100 })) found.set(p.id, p);
  }
  let candidates = [...found.values()].filter((p) => p.id !== product.id && recipeKey(p.name, brandNames(marque)) === key);
  if (marque?.id && candidates.length) {
    const brands = await productBrands(candidates.map((p) => p.id));
    candidates = candidates.filter((p) => brands.get(p.id)?.has(marque.id));
  }
  const declinaisons = await loadDeclinaisons(key, marque);
  return [...candidates.map(summarize), ...declinaisons]
    .sort((a, b) => (ORDER_FORMATS[a.categories[0]] || 9) - (ORDER_FORMATS[b.categories[0]] || 9));
};

// Formats vendus en déclinaison d'une page qui regroupe tous les goûts : puffs (« Puff JNR Falcon Crest
// 58K ») et flacon sans nicotine (« JNR Sans Nicotine 10ml »). On compare le NOM du goût : son slug peut
// être mal saisi (blueberry-rasperry-cherry) et « lady-shigeri » n'est pas « shigeri ». Même marque
// racine exigée. Une rupture ne retire rien (le stock revient) ; seule la dépublication retire. Le lien pré-sélectionne le goût.
const DECLINAISON_CATS = ['puffs', 'eliquides-10ml', 'cartouches-pre-remplies'];
const slugOf = (s) => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const loadDeclinaisons = async (key, marque) => {
  const slug = slugOf(key);
  if (!slug) return [];
  const vars = [];
  for (const k of recipeNames(key)) vars.push(...await wpGet('wc/store/v1/products', { search: k, type: 'variation', per_page: 100 }).catch(() => []));
  const parents = new Map();
  for (const v of vars) {
    if (!v.parent || parents.has(v.parent)) continue;
    const m = String(v.permalink || '').match(/[?&]attribute_pa_gout=([^&]+)/);
    if (!m) continue;
    const gout = (decode(String(v.variation || '')).match(/(?:saveur|go[uû]t)\s*:\s*([^,]+)/i) || [])[1];
    if (gout ? recipeKey(gout, brandNames(marque)) === key : decodeURIComponent(m[1]) === slug) {
      parents.set(v.parent, { url: v.permalink, gout: decodeURIComponent(m[1]) });
    }
  }
  if (!parents.size) return [];
  let ids = [...parents.keys()];
  if (marque?.id) {
    const brands = await productBrands(ids);
    ids = ids.filter((id) => brands.get(id)?.has(marque.id));
  }
  const out = [];
  for (const id of ids) {
    const p = await wpGet(`wc/store/v1/products/${id}`).catch(() => null);
    const cat = p && DECLINAISON_CATS.find((c) => (p.categories || []).some((x) => x.slug === c));
    if (!cat) continue;
    // Pas de description : celle de la page parle de tous ses goûts, et elle gonflerait chaque appel à Claude.
    const { attributs } = summarize(p);
    out.push({
      id,
      nom: decode(p.name),
      url: parents.get(id).url,
      chemin: pathOf(parents.get(id).url),
      categories: [cat],
      attributs: Object.fromEntries(Object.entries(attributs).filter(([k]) => /nicotine|contenance/i.test(k))),
      gout: parents.get(id).gout,
      page_partagee: true,
    });
  }
  return out;
};

// Fiche publiée : lue sur le site par les API publiques.
// Faits confirmés par la boutique pour toute une marque, absents ou incomplets dans les attributs.
const FAITS_MARQUE = {
  jnr: ['Toutes les recettes JNR contiennent un agent frais, y compris quand l\'attribut « Frais » manque sur la fiche (confirmé par la boutique le 09/11/2026).', 'Luv 66 et Love 66 sont la même recette : JNR la renomme progressivement en Luv 66. Écris le nom de la fiche rédigée, sans signaler l\'écart.'],
};
const withBrandFacts = (marque) => (marque ? { ...marque, faits: FAITS_MARQUE[norm(marque.nom)] || [] } : marque);

// Page qui regroupe tous les goûts d'un e-liquide (« JNR Sans Nicotine 10ml ») : ce n'est pas une recette.
const isMultiFlavour = (categories, gouts) => gouts.length >= 2 && categories.some((c) => /^(eliquides|concentres)/.test(c));
const goutsOf = (raw) => (raw.attributes || []).filter((a) => a.taxonomy === 'pa_gout' && a.has_variations).flatMap((a) => a.terms.map((t) => decode(t.name)));

const loadDossier = async (productId) => {
  const raw = await wpGet(`wc/store/v1/products/${productId}`);
  const product = summarize(raw);
  const marque = await loadBrand(productId);
  const key = recipeKey(product.nom, brandNames(marque));
  const gouts = goutsOf(raw);
  if (isMultiFlavour(product.categories, gouts)) {
    return { produit: product, recette: key, autres_formats: [], marque: withBrandFacts(marque), page_multi_gouts: true, gouts };
  }
  const formats = await loadFormats(product, key, marque);
  return { produit: product, recette: key, autres_formats: formats, marque: withBrandFacts(marque) };
};

// Fiche envoyée par l'extension WordPress (brouillon compris) : la fiche vient
// de l'admin, les autres formats de la recette sont lus sur le site public.
const dossierFromPayload = async (p) => {
  const product = {
    id: Number(p.id) || null,
    nom: decode(String(p.name || '')).trim(),
    url: p.permalink || null,
    chemin: p.permalink ? pathOf(p.permalink) : null,
    statut: p.status || null,
    categories: Array.isArray(p.categories) ? p.categories.map(String) : [],
    attributs: Object.fromEntries(Object.entries(p.attributes || {}).map(([k, v]) => [decode(k), (Array.isArray(v) ? v : [v]).map((x) => decode(String(x)))])),
    description_courte: textOf(p.short_description),
    description_longue: textOf(p.description),
  };
  if (!product.nom) throw new Error('Nom du produit manquant');
  const marque = p.brand?.name ? {
    id: Number(p.brand.id) || null,
    nom: decode(p.brand.name),
    chemin: p.brand.link ? pathOf(p.brand.link) : null,
    gamme: p.brand.range?.name ? { id: Number(p.brand.range.id) || null, nom: decode(p.brand.range.name), chemin: p.brand.range.link ? pathOf(p.brand.range.link) : null, catalogue: await loadBrandCatalog(Number(p.brand.range.id) || null) } : null,
    page_marque_extrait: textOf(p.brand.description).slice(0, 1200),
    catalogue: await loadBrandCatalog(Number(p.brand.id) || null),
  } : null;
  const key = recipeKey(p.recette || product.nom, brandNames(marque));
  const gouts = Array.isArray(p.gouts) ? p.gouts.map((g) => decode(String(g))) : [];
  if (isMultiFlavour(product.categories, gouts)) {
    return { produit: product, recette: key, autres_formats: [], marque: withBrandFacts(marque), page_multi_gouts: true, gouts };
  }
  const formats = await loadFormats(product, key, marque);
  return { produit: product, recette: key, autres_formats: formats, marque: withBrandFacts(marque) };
};

/* ─── Search Console ───────────────────────────────────── */

// Trois familles de requêtes, pour qu'une recette au nom générique (« fraise »)
// ne soit pas noyée sous les requêtes des autres marques :
//   recette + marque · recette sans la marque · marque sans la recette.
const loadGsc = async (dossier) => {
  const R = recipeNames(dossier.recette).flatMap(variants).map((t) => `%${t}%`);
  const B = brandNames(dossier.marque).flatMap(variants).map((t) => `%${t}%`);
  const to = (await pool.query("SELECT MAX(date) AS max FROM gsc_query_daily WHERE country = 'all'")).rows[0].max;
  const select = async (where, params, limit) => (await pool.query(
    `SELECT query, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks,
            ROUND((SUM(position * impressions) / NULLIF(SUM(impressions), 0))::numeric, 1) AS position
     FROM gsc_query_daily
     WHERE country = 'all' AND date > $1::date - $2::int AND ${where}
     GROUP BY query HAVING SUM(impressions) >= 5 ORDER BY 2 DESC LIMIT ${limit}`,
    [to, GSC_DAYS, ...params]
  )).rows;
  const groups = B.length ? {
    recette_et_marque: await select('query ILIKE ANY($3) AND query ILIKE ANY($4)', [R, B], 40),
    recette_sans_marque: await select('query ILIKE ANY($3) AND NOT (query ILIKE ANY($4))', [R, B], 25),
    marque_sans_recette: await select('NOT (query ILIKE ANY($3)) AND query ILIKE ANY($4)', [R, B], 15),
  } : { recette: await select('query ILIKE ANY($3)', [R], 60) };
  const q = { rows: Object.values(groups).flat() };
  const urls = [dossier.produit.url, ...dossier.autres_formats.map((f) => f.url)].filter(Boolean);
  const pages = await pool.query(
    `SELECT page, query, SUM(impressions)::int AS impressions,
            ROUND((SUM(position * impressions) / NULLIF(SUM(impressions), 0))::numeric, 1) AS position
     FROM gsc_search_daily
     WHERE date > $1::date - $2::int AND query = ANY($3)
     GROUP BY page, query ORDER BY 3 DESC`,
    [to, GSC_DAYS, q.rows.map((r) => r.query)]
  );
  const byQuery = new Map();
  for (const r of pages.rows) {
    if (!byQuery.has(r.query)) byQuery.set(r.query, []);
    byQuery.get(r.query).push({ chemin: pathOf(r.page), impressions: r.impressions, position: Number(r.position) });
  }
  const fmt = (rows) => rows.map((r) => ({
    requete: r.query,
    impressions: r.impressions,
    clics: r.clicks,
    position: Number(r.position),
    pages: (byQuery.get(r.query) || []).slice(0, 3),
  }));
  const ownImpressions = pages.rows.filter((r) => urls.includes(r.page)).reduce((s, r) => s + r.impressions, 0);
  return {
    periode: `${GSC_DAYS} jours jusqu'au ${new Date(to).toISOString().slice(0, 10)}`,
    requetes: Object.fromEntries(Object.entries(groups).map(([k, rows]) => [k, fmt(rows)])),
    pages_de_la_recette: urls.map(pathOf),
    // Produit ou marque récents : pas d'antériorité, ce n'est pas une absence de demande.
    sans_historique: ownImpressions === 0,
  };
};

/* ─── Google Ads (Keyword Planner) ─────────────────────── */

// Quota, cache et file d'appels partagés avec l'onglet « Mots clés » du Suivi SEO.
const adsPost = (method, body) => ads.call(method, body, { source: 'fiche' });

const loadAds = async (dossier, gsc) => {
  // Les deux noms sont mesurés : c'est le volume qui dit si la marque mère l'emporte sur la gamme.
  const names = brandNames(dossier.marque);
  const seeds = [names[0] && `${dossier.recette} ${names[0]}`, dossier.recette, ...names, ...names.slice(1).map((n) => `${dossier.recette} ${n}`), `e liquide ${dossier.recette}`, ...recipeNames(dossier.recette).slice(1).map((k) => names[0] ? `${k} ${names[0]}` : k)].filter(Boolean);
  const fromGsc = Object.values(gsc.requetes).flatMap((rows) => rows.slice(0, 6)).map((r) => r.requete);
  const keywords = [...new Set([...seeds, ...fromGsc].map(norm))].slice(0, 20);
  const hist = await adsPost('generateKeywordHistoricalMetrics', { keywords });
  const volumes = (hist.results || []).map((r) => ({
    requete: r.text,
    volume_mensuel: Number(r.keywordMetrics?.avgMonthlySearches || 0) || null,
    variantes: r.closeVariants || [],
  }));
  // Idées voisines qui contiennent le nom de la recette (le reste est hors sujet).
  const ideas = await adsPost('generateKeywordIdeas', { keywordSeed: { keywords: seeds.slice(0, 2) }, pageSize: 100 });
  // Idées voisines qui contiennent la recette ou la marque (le reste est hors sujet).
  const recipeWords = norm(dossier.recette).split(' ');
  const brandForms = names.flatMap(variants);
  const idees = (ideas.results || [])
    .filter((r) => recipeWords.every((w) => norm(r.text).includes(w)) || brandForms.some((b) => norm(r.text).includes(b)))
    .map((r) => ({ requete: r.text, volume_mensuel: Number(r.keywordIdeaMetrics?.avgMonthlySearches || 0) || null }))
    .filter((r) => !volumes.some((v) => norm(v.requete) === norm(r.requete)))
    .sort((a, b) => (b.volume_mensuel || 0) - (a.volume_mensuel || 0))
    .slice(0, 20);
  return { volumes, idees };
};

/* ─── Appels à Claude ──────────────────────────────────── */

const usage = { input: 0, output: 0, searches: 0, fetches: 0, calls: 0, tool_errors: [] };

const claude = async (body) => {
  let messages = body.messages;
  let res;
  for (let i = 0; i < 4; i++) {
    res = await axios.post(ANTHROPIC_URL, { model: MODEL, max_tokens: 16000, ...body, messages }, {
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 600000,
    });
    const u = res.data.usage || {};
    usage.input += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    usage.output += u.output_tokens || 0;
    usage.searches += u.server_tool_use?.web_search_requests || 0;
    usage.fetches += u.server_tool_use?.web_fetch_requests || 0;
    // Erreurs des outils serveur (page refusée, adresse non autorisée…) : gardées pour le diagnostic.
    for (const b of res.data.content || []) {
      const c = b.content;
      if (/_tool_result$/.test(b.type || '') && c && /error/.test(c.type || '')) usage.tool_errors.push(`${b.type}: ${c.error_code || c.type}`);
    }
    usage.calls += 1;
    if (res.data.stop_reason !== 'pause_turn') break;
    // Recherche web longue : on renvoie la réponse partielle, le serveur reprend.
    messages = [...body.messages, { role: 'assistant', content: res.data.content }];
  }
  if (res.data.stop_reason === 'refusal') throw new Error('Claude a refusé la demande');
  if (res.data.stop_reason === 'max_tokens') throw new Error('Réponse de Claude tronquée (max_tokens)');
  return (res.data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
};

const parseJson = (text) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Réponse sans JSON');
  return JSON.parse(text.slice(start, end + 1));
};

/* ─── Concurrents ──────────────────────────────────────── */

// Relevé concurrentiel en trois temps :
//   1. Claude cherche les fiches (recherche web seule, pas d'ouverture de page) ;
//   2. notre serveur télécharge chaque page et n'en garde que le texte utile (sans menus ni pied
//      de page) : gratuit, alors que l'outil d'ouverture facturait les menus et coupait avant la
//      description (Heisenberg, 06/11 : aucune des 3 fiches lue en entier) ;
//   3. Claude compare ces textes à notre dossier, sans outil.
const findCompetitors = async (dossier, { elargi = false } = {}) => {
  const p = dossier.produit;
  const contenance = p.attributs['Contenance du Flacon']?.[0] || p.attributs['Contenance e-liquide']?.[0] || '';
  const categorie = /concentr/i.test(p.nom) ? 'concentré' : 'e-liquide';
  const text = await claude({
    output_config: { effort: 'low' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location: { type: 'approximate', country: 'FR', timezone: 'Europe/Paris' } }],
    messages: [{
      role: 'user',
      content: `Trouve les fiches produit concurrentes de « ${p.nom} » (${commercialName(dossier.marque) || 'marque inconnue'}${contenance ? `, ${contenance}` : ''}).
Cherche « ${categorie} ${dossier.recette} ${commercialName(dossier.marque)} », puis si besoin « ${dossier.recette} ${commercialName(dossier.marque)} ${contenance} » (le mot ${categorie} évite les homonymes).
Garde les 8 premières boutiques FRANÇAISES qui vendent ${elargi ? `cette recette, dans ce format si possible, sinon dans un autre format (grand format, sel de nicotine, concentré)` : 'ce produit dans ce format'} (pas youvape.fr, pas de forum, pas de comparateur), dans l'ordre des résultats. Note aussi le site du fabricant s'il apparaît.
Réponds uniquement par un objet JSON : {"concurrents":[{"site":"","url":"","title":""}],"fabricant":{"url":"","origine":""}}`,
    }],
  });
  return parseJson(text);
};

// Texte utile d'une fiche concurrente : titres et paragraphes, sans navigation. null = page illisible.
const readCompetitorPage = async (url) => {
  try {
    const res = await axios.get(url, {
      // Accept d'un navigateur : certains sites répondent 200 vide à celui d'axios (Ecigplanete).
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'fr-FR,fr;q=0.9', Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      timeout: 20000, maxContentLength: 8e6, responseType: 'text',
    });
    const html = String(res.data || '');
    // Page de blocage : courte et sans contenu. Une vraie fiche peut contenir « captcha » (script reCAPTCHA).
    if (!/<html/i.test(html) || (html.length < 15000 && /cf-challenge|Just a moment|captcha|access denied/i.test(html))) return null;
    const title = textOf((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    const h1 = textOf((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
    const rating = html.match(/"ratingValue"\s*:\s*"?([\d.,]+)"?[\s\S]{0,200}?"(?:reviewCount|ratingCount)"\s*:\s*"?(\d+)/);
    let body = html.replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|iframe|select|button)\b[\s\S]*?<\/\1>/gi, ' ');
    body = body.replace(/<h([1-4])[^>]*>/gi, '\n## ').replace(/<\/(p|div|li|h\d|tr|td|dd|dt|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
    const seen = new Set();
    const lines = decode(body.replace(/<[^>]+>/g, ' ')).split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      // Titres courts, ou vraies phrases : les entrées de menu (1 à 5 mots) disparaissent.
      .filter((l) => (l.startsWith('## ') ? l.length < 140 && l.length > 4 : l.split(' ').length >= 7))
      .filter((l) => !seen.has(l) && seen.add(l));
    const out = [];
    let n = 0;
    for (const l of lines) {
      n += l.split(' ').length;
      if (n > 1400) break;
      out.push(l);
    }
    return {
      title, h1,
      note: rating ? `${rating[1]}/5 sur ${rating[2]} avis` : null,
      intertitres: lines.filter((l) => l.startsWith('## ')).map((l) => l.slice(3)).slice(0, 25),
      mots: lines.filter((l) => !l.startsWith('## ')).join(' ').split(' ').length,
      texte: out.join('\n'),
    };
  } catch {
    return null;
  }
};

const loadCompetitors = async (dossier) => {
  const found = await findCompetitors(dossier);
  // Format peu répandu (sel de nicotine d'une recette) : la recherche stricte peut ne rien rendre,
  // alors que la règle exige 3 fiches lues. On élargit à la même recette dans un autre format.
  if ((found.concurrents || []).length < 5) {
    const large = await findCompetitors(dossier, { elargi: true });
    const vus = new Set((found.concurrents || []).map((c) => c.url));
    found.concurrents = [...(found.concurrents || []), ...(large.concurrents || []).filter((c) => !vus.has(c.url))];
    found.fabricant = found.fabricant || large.fabricant;
  }
  const pages = [];
  // Règle (Maxime, 06/11) : toujours 3 fiches lues au moins. Une boutique qui bloque est sautée,
  // on passe à la suivante.
  for (const c of found.concurrents || []) {
    if (pages.filter((x) => x.lu).length >= 3) break;
    const page = /^https:\/\//.test(c.url || '') && !/youvape\.fr/.test(c.url) ? await readCompetitorPage(c.url) : null;
    pages.push({ site: c.site, url: c.url, lu: !!page, ...(page || { title: c.title }) });
  }
  const lues = pages.filter((x) => x.lu);
  // Boutiques qui bloquent les robots (Taffe-elec, Le Petit Vapoteur : 403) : on ne contourne pas,
  // Claude les ouvre avec son propre outil, 2 au plus, texte plafonné.
  const manquantes = Math.max(0, 3 - lues.length);
  const text = await claude({
    output_config: { effort: 'medium' },
    ...(manquantes > 0 ? { tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: manquantes, max_content_tokens: 10000 }] } : {}),
    messages: [{
      role: 'user',
      content: `Compare les fiches concurrentes ci-dessous à la nôtre (dossier youvape.fr), pour « ${dossier.produit.nom} » (${commercialName(dossier.marque)}).
Pour chaque fiche lue, relève sans recopier leurs phrases : nombre de mots, faits annoncés (contenance, PG/VG ou solvant, nicotine, origine, dosage, maturation, autres formats), intertitres et questions traités, liens vers d'autres formats, avis affichés.
Puis liste dans "a_ajouter" ce que ces fiches apportent à l'acheteur et que notre fiche n'a pas encore : rubriques, questions, informations pratiques. Indique pour chacun si nos données (attributs, descriptions de la boutique) permettent de l'écrire ("source": "attribut …" ou "aucune"). Écarte ce qui est interdit chez nous : avis, notes, classements, adjectifs valorisants, ressenti, santé.

Notre dossier : ${JSON.stringify({ produit: dossier.produit, autres_formats: dossier.autres_formats.map((f) => ({ nom: f.nom, gout: f.gout, attributs: f.attributs })) })}

Fiches concurrentes (texte extrait de la page, sans menus) :
${JSON.stringify(pages)}
${manquantes > 0 ? `\nLes fiches marquées "lu": false n'ont pas pu être lues par notre serveur : ouvre-en ${manquantes} au plus avec l'outil web_fetch (les premières de la liste), et ignore menus et pied de page.\n` : ''}
Réponds uniquement par un objet JSON :
{"concurrents":[{"site":"","url":"","lu":true,"title":"","h1":"","mots":0,"note":"","faits":{"contenance":"","pg_vg":"","nicotine":"","origine":"","dosage":"","maturation":"","autres_formats":""},"intertitres":[""],"liens_autres_formats":""}],"a_ajouter":[{"element":"","qui_le_fait":"","source":""}],"constats":["3 à 6 constats utiles pour notre fiche"]}`,
    }],
  });
  const out = parseJson(text);
  out.fabricant = found.fabricant || null;
  out.pages_lues = `${lues.length} sur ${pages.length} ouvertes`;
  return out;
};

/* ─── Rédaction ────────────────────────────────────────── */

const RULES = `Tu rédiges les champs d'une fiche produit WooCommerce de youvape.fr (boutique française de vape). Les blocs factuels (tableau d'attributs, autres formats, conditions d'utilisation, étapes de préparation d'un concentré avec dosage, maturation et rendement, questions) sont construits automatiquement par le site à partir des attributs : tu ne les réécris pas.

TU RÉDIGES
1. title Yoast : « E-liquide », puis le nom de la recette, le nom commercial (voir IDENTITÉ : la sous-marque s'il y en a une) et la contenance (« E-liquide Red Astaire T-Juice 10ml », « E-liquide Shigeri Fighter Fuel 100ml »). Jamais « YouVape » : Google affiche déjà le nom du site à part. Pour un concentré, pas de « E-liquide » : son nom commence par « Concentré ». 60 caractères maximum ; si ça dépasse, retire « E-liquide » du title. La contenance distingue les formats d'une même recette, qui se partagent sinon la même recherche.
2. méta-description : 120 à 155 caractères, factuelle (catégorie, marque, contenance, PG/VG, arômes en quelques mots ; nicotine sans citer les taux).
3. H1 : ce champ remplace le nom du produit. Le site ajoute tout seul « Eliquide » devant (sur un e-liquide) et « - {marque} » derrière : n'écris ni l'un ni l'autre, ni la marque. Écris « {Nom} {Contenance} » (« Red Astaire 10ml », « Shigeri Salt 10ml », « Shigeri 100ml », « Concentré Heisenberg 30ml »), qui s'affichera « Eliquide Shigeri Salt 10ml - Fighter Fuel ».
4. composition_aromatique : 20 à 60 mots, texte saisi une fois pour TOUTE la recette (il s'affiche sur chaque format) : liste des arômes et additifs, rien d'autre. Ni contenance, ni PG/VG, ni nicotine (ils varient selon le format), ni remarque sur le nom ou la marque. Il s'affiche sous l'intertitre « Composition aromatique de {recette} » : ne commence pas par répéter cet intertitre.
5. texte_marque : 30 à 60 mots de faits sur la marque que l'on cite, pas sur ce produit : la sous-marque si le dossier en a une (marque.gamme, source : marque.gamme.catalogue), sinon la marque (source : marque.catalogue), puffs comprises. Activité, types de produits proposés, pays de fabrication. Une sous-marque peut dire de quel fabricant elle dépend. Ne liste pas les autres marques ni les gammes : le site les affiche lui-même sous ce texte. Saisi une fois, il s'affiche sur toutes les fiches de cette marque : il ne doit citer ni ce produit ni sa recette.
6. presentation (description courte, 40 à 80 mots, texte brut, 1 ou 2 paragraphes séparés par une ligne vide) : premier texte de « La Description du Produit », repris aussi dans les données produit. Ouvre sur la catégorie, le nom et le nom commercial (« Le e-liquide Red Astaire de T-Juice… », « Le e-liquide Shigeri de Fighter Fuel… »), en plaçant la requête principale telle qu'elle se dit ; puis ce que contient le flacon : arômes, contenance, nicotine (sans citer les taux, voir RÉDACTION), PG/VG, pays de fabrication. Réécris entièrement la description courte actuelle (fautes, « Tjuice », « e liquide ») ; garde ses faits seulement s'ils sont confirmés par les attributs. Ne cite pas les autres formats : une phrase automatique les liste juste dessous.
7. description (description longue, 15 à 60 mots, texte brut) : liste des ingrédients du liquide (propylène glycol et glycérine végétale avec leur part, arômes alimentaires, nicotine selon le taux choisi) et fabricant, en une ou deux phrases. Elle s'affiche sous l'intertitre « Ingrédients de {recette} » : ne commence ni par « Ingrédients » ni par le nom du produit. Ne répète pas la présentation. Elle remplace la fiche technique actuelle, dont le tableau du site reprend déjà le reste. Pour un CONCENTRÉ (arôme DIY) : le contenu du flacon (arômes, et le solvant seulement s'il est connu), sans reprendre le dosage, la maturation ni les étapes de préparation, que le site affiche. Au-delà de 150 mots, le site cesse d'ajouter ses blocs automatiques : reste court.

Les textes sont publiés : n'y parle jamais de tes sources ni de la boutique en coulisse (« attribut », « dossier », « fiche », « selon la description »). Écris le fait lui-même (« fabriqué en France »).

Vocabulaire du tirage (ne pas confondre) : MTL = inhalation indirecte, tirage serré ; RDL = inhalation directe restreinte, tirage semi-aérien ; DL = inhalation directe, tirage aérien.

IDENTITÉ DU PRODUIT : NOM + MARQUE + CATÉGORIE (impératif)
- Nom commercial : si le dossier a une sous-marque (marque.gamme), c'est elle qu'on cite dans 9 cas sur 10 : « Shigeri de Fighter Fuel », « Shigeri Fighter Fuel 100ml », jamais « Shigeri de Maison Fuel » ni les deux à la suite (« Shigeri Fighter Fuel Maison Fuel »). Tous les champs suivent cette règle, requête principale comprise, sauf texte_marque qui décrit la marque mère. Exception : la marque mère seulement si la Search Console ou Google Ads montrent nettement plus de recherches recette + marque mère que recette + sous-marque ; dis-le alors dans "analyse". Sans sous-marque, le nom commercial est la marque.
- Rédige toujours à partir des trois : le nom de la recette, la marque et la catégorie (e-liquide 10ml, grand format, sel de nicotine, concentré…). La boutique vend des dizaines de recettes au nom générique (« Fraise », « Menthe », « Classic ») : c'est la marque qui distingue la fiche dans Google. Pour un nom générique, la requête principale associe toujours la recette et la marque (« fraise kiwi vapor »), jamais la recette seule.
- Quand le nom de la marque contient un mot qui peut se lire comme un arôme (Kiwi Vapor, Fruizee…), relie toujours la recette à la marque par « de » : « Fraise de Kiwi Vapor », jamais « Fraise Kiwi » ni « Fraise Kiwi Vapor », qui feraient croire à une recette fraise-kiwi. Même règle dans le title et le H1 (« E-liquide Fraise de Kiwi Vapor 10ml »).
- Produit nouveau ou marque récente : la Search Console peut être vide (aucune antériorité). Ce n'est pas une absence de demande. Appuie-toi alors sur les volumes Google Ads de la recette avec la marque, de la marque seule et de la recette en e-liquide (« e liquide fraise »), et vise la combinaison recette + marque + catégorie. Dis-le dans "analyse".

PAGE À PLUSIEURS GOÛTS (page_multi_gouts dans le dossier, ex. « JNR Sans Nicotine 10ml »)
- Cette page regroupe tous les goûts listés dans "gouts" : ce n'est pas une recette, ne l'appelle jamais « recette » et ne la relie pas par « de » à sa marque.
- title : le mot « E-liquide » puis le nom du produit, sans ajouter la marque s'il la contient déjà (« E-liquide JNR Sans Nicotine 10ml »). H1 : le nom du produit tel quel (« JNR Sans Nicotine 10ml »).
- composition_aromatique : chaîne vide. Le site affiche lui-même le tableau des goûts et de leurs arômes.
- presentation : ce que contient la gamme (contenance, PG/VG, sans nicotine, plusieurs goûts au choix) sans énumérer les goûts ni en donner le nombre, qui changent.
- description : les ingrédients communs seulement, pas la liste des goûts.
- Requêtes : celles de la marque et du type de produit (« jnr sans nicotine », « liquide jnr »). Une requête qui nomme un goût revient à la fiche de ce goût : mets-la dans "requetes_laissees".
- Ne signale pas dans "points_a_verifier" que les goûts ou leurs arômes manquent au texte.

MOTS-CLÉS
- Choisis la requête principale et 2 à 5 secondaires à partir des données Search Console (impressions, position, page affichée) et Google Ads (volumes). Explique tes choix dans "analyse".
- Une même requête ne doit pas être portée par deux formats de la recette. Priorité de la boutique (marge) : le flacon 10ml porte le nom seul de la recette et les requêtes génériques (« red astaire », « e liquide red astaire »), même si un autre format est mieux placé aujourd'hui ; puis les grands formats ; les concentrés en dernier. Un format moins prioritaire ne garde que les requêtes qui le nomment (« 50ml », « grand format », « concentré », « sel de nicotine »). Pour un format autre que le 10ml, ne vise pas le nom seul de la recette si un 10ml existe. La contenance dans le title et le H1 sert à séparer les formats.
- Un format marqué page_partagee (déclinaison d'une page qui regroupe tous les goûts : puff, « JNR Sans Nicotine 10ml ») ne peut porter aucune requête de recette et ne compte pas comme le 10ml de la recette. S'il n'existe pas d'autre 10ml, c'est le grand format qui porte le nom seul de la recette et les requêtes génériques (marge supérieure, même règle que Fighter Fuel) ; le sel de nicotine garde les requêtes qui le nomment (« salt », « sel de nicotine », « 10ml »). Cite ce flacon sans nicotine comme un format disponible, sans le présenter comme la fiche de la recette.
- Écarte les requêtes avec prix, promo, avis, meilleur, gratuit, livraison, santé.
- Si la recette existe en puff (autres_formats de catégorie « puffs », souvent plusieurs modèles), les requêtes « puff + recette » vont à la page puff : mets-les dans "requetes_laissees", pas dans les écartées. Le site affiche lui-même la puff dans les autres formats et la FAQ.
- Écarte aussi les requêtes qui visent un autre type de produit qui n'est PAS dans autres_formats (puff d'une autre marque, pod, cartouche) ou une autre marque (« puff jnr gorilla x strawberry ice ») : un nom de recette générique (« strawberry ice », « fraise ») a souvent un gros volume qui ne concerne pas notre produit. Le volume d'une recette générique sert de contexte, pas de cible.

CONCURRENTS
- Le dossier contient un relevé des fiches concurrentes, dont "a_ajouter" : ce qu'elles apportent et que notre fiche n'a pas. Intègre ce qui est objectif ET confirmé par nos attributs ou descriptions ; signale le reste dans "points_a_verifier" (une ligne par élément : ce qu'il faudrait renseigner pour pouvoir l'écrire). Explique dans "analyse" ce que tu as repris des concurrents.

FAITS (impératif)
- Seules sources de faits : les attributs de la fiche et des autres formats, puis les descriptions de la boutique. Les concurrents et la page marque actuelle servent de contexte, jamais de source.
- Ne signale PAS dans "points_a_verifier" le matériel, la résistance ni la conservation, que le site affiche d'après les attributs, ni la mention réservée aux majeurs, ni le code EAN.
- marque.faits contient des faits confirmés par la boutique : ils sont une source au même titre que les attributs et priment sur un attribut manquant. Écris « agent frais » s'il y est, sans parler d'intensité de fraîcheur : c'est du ressenti, et le mot Ice reste réservé au nom officiel.
- En cas de contradiction, l'attribut fait foi (ex. Origine). Signale toute contradiction dans "points_a_verifier".
- N'invente rien. Un fait absent n'est pas écrit : signale-le dans "points_a_verifier".
- Ne signale PAS dans "points_a_verifier" les allégations nicotine, mots interdits ou formulations marketing des descriptions actuelles (de cette fiche ou des autres formats) : leur suppression est décidée et se fait à chaque réécriture, sans le dire.

RÉDACTION (publicité des produits du vapotage interdite, litige DNF en cours : impératif)
- Frais et menthe sont deux attributs distincts. N'écris « menthe » ou « menthol » que si un attribut l'indique (« Saveurs de Plantes : Menthe » ou « Saveur Menthe ») ou si c'est dans le nom du produit. L'attribut « Frais » seul s'écrit « note fraîche » ou « agent frais », jamais menthe. Un liquide peut être à la menthe sans être frais : n'ajoute pas « frais » sans l'attribut. Ne signale pas qu'il faudrait préciser la nature de la note fraîche.
- Dans composition_aromatique, n'écris pas « saveur(s) » : écris « arômes » et « famille ».
- Fabriqué en Chine n'est pas un atout : ne l'écris pas dans le title, la méta, la présentation ni le texte de marque. Il reste permis dans "description" (ingrédients), et le tableau du site l'affiche. Une origine France peut s'écrire partout.
- N'écris jamais « YouVape », « youvape.fr », « chez nous » ni « notre boutique », dans aucun champ : ni le SEO ni l'autorité n'en ont besoin.
- Informations objectives seulement : composition, contenance, nicotine, PG/VG, formats vendus.
- Ne cite JAMAIS les taux de nicotine disponibles (« 3, 6, 12 ou 18mg ») dans aucun champ : un taux retiré du catalogue resterait écrit et le client irait le chercher ailleurs. Le tableau du site les affiche, à jour. Écris « avec plusieurs taux de nicotine au choix », « sans nicotine, à booster » (grand format vendu sans nicotine) ou « en sel de nicotine ».
- Les noms d'arômes et de fruits sont permis (décision du 06/11/2026) : ils décrivent la composition (« arômes de fruits rouges, de raisin noir, d'anis et d'eucalyptus, avec une note fraîche »).
- JAMAIS d'allégation sur l'effet de la nicotine ou du produit sur le corps : absorption, passage dans le sang, « hit » plus ou moins prononcé, douceur en gorge, satisfaction.
- JAMAIS : adjectif valorisant (célèbre, culte, incontournable, délicieux, rafraîchissant, intense, parfait, idéal, unique…), description de ressenti ou de sensation (fraîcheur en bouche, explosion, douceur…), classement de ventes (best-seller, le plus vendu), prix, promotion, avis, santé, sevrage, comparaison avec le tabac, lien vers le blog, mot « ice » (sauf dans le nom officiel du produit, repris tel quel : « Watermelon Ice Salt »).
- Pas de point d'exclamation, pas de deuxième personne (« vous allez adorer »).

Réponds en français.`;

const SCHEMA = {
  type: 'object',
  properties: {
    analyse: { type: 'string' },
    requete_principale: { type: 'string' },
    requetes_secondaires: { type: 'array', items: { type: 'string' } },
    requetes_laissees: { type: 'array', items: { type: 'object', properties: { requete: { type: 'string' }, page: { type: 'string' }, raison: { type: 'string' } }, required: ['requete', 'page', 'raison'], additionalProperties: false } },
    requetes_ecartees: { type: 'array', items: { type: 'object', properties: { requete: { type: 'string' }, raison: { type: 'string' } }, required: ['requete', 'raison'], additionalProperties: false } },
    title: { type: 'string' },
    meta: { type: 'string' },
    h1: { type: 'string' },
    composition_aromatique: { type: 'string' },
    texte_marque: { type: 'string' },
    presentation: { type: 'string' },
    description: { type: 'string' },
    points_a_verifier: { type: 'array', items: { type: 'string' } },
  },
  required: ['analyse', 'requete_principale', 'requetes_secondaires', 'requetes_laissees', 'requetes_ecartees', 'title', 'meta', 'h1', 'composition_aromatique', 'texte_marque', 'presentation', 'description', 'points_a_verifier'],
  additionalProperties: false,
};

const generate = async (data) => {
  const text = await claude({
    system: RULES,
    output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: `Dossier de la fiche (JSON) :\n\n${JSON.stringify(data, null, 1)}` }],
  });
  return JSON.parse(text);
};

/* ─── Contrôles ────────────────────────────────────────── */

const MARKETING = /c[eé]l[eè]bre|culte|incontournable|d[eé]licieu|rafra[iî]chissant|intense|parfait|id[eé]al|unique|exceptionnel|incroyable|best[- ]?seller|plus vendu|explosion|douceur|gourmand|addictif|irr[eé]sistible|savoureu|subtil|[eé]quilibr[eé]|l[eé]gendaire|\bice\b|\bvous\b|!/i;
const HEALTH = /danger|cancer|sant[eé]|risque|nocif|toxique|sevrage|arr[eê]ter de fumer|tabac|absorption|absorb|\bhit\b|en gorge|dans le sang|organisme|satisfaction/i;
const ALLOWED_GENERIC = new Set(['saveur', 'saveurs', 'gout', 'gouts']);

// Le nom officiel du produit (« Watermelon Ice Salt ») se reprend tel quel :
// ses mots ne sont pas jugés comme une formulation de l'auteur.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lint = (d, productName = '', { multi = false, marques = [], menthe = true } = {}) => {
  const issues = [];
  const fields = { title: d.title, meta: d.meta, h1: d.h1, composition_aromatique: d.composition_aromatique, texte_marque: d.texte_marque, presentation: d.presentation, description: d.description };
  const nameRe = productName.trim() ? new RegExp(escapeRe(decode(productName).trim()), 'gi') : null;
  for (const [k, raw] of Object.entries(fields)) {
    const v = nameRe ? raw.replace(nameRe, ' ') : raw;
    const tokens = norm(v).split(/[^a-z0-9]+/);
    const banned = [...new Set(tokens.filter((t) => BANNED.has(t) && !ALLOWED_GENERIC.has(t)))];
    if (banned.length) issues.push({ champ: k, gravite: 'bloquant', message: `mot interdit : ${banned.join(', ')}` });
    const generic = [...new Set(tokens.filter((t) => ALLOWED_GENERIC.has(t)))];
    if (generic.length) issues.push({ champ: k, gravite: 'avocat', message: `« ${generic.join(', ')} » : usage neutre à confirmer` });
    if (/you ?vape/i.test(raw)) issues.push({ champ: k, gravite: 'à revoir', message: 'cite YouVape : inutile, à retirer' });
    const m = v.match(MARKETING);
    if (m) issues.push({ champ: k, gravite: 'bloquant', message: `formulation marketing : « ${m[0]} »` });
    const h = v.match(HEALTH);
    if (h) issues.push({ champ: k, gravite: 'bloquant', message: `santé / tabac : « ${h[0]} »` });
  }
  const len = (k, min, max, unit = 'caractères') => {
    const n = unit === 'mots' ? words(fields[k]) : fields[k].length;
    if (n < min || n > max) issues.push({ champ: k, gravite: 'à revoir', message: `${n} ${unit} (attendu ${min} à ${max})` });
  };
  for (const k of ['title', 'meta', 'presentation', 'description']) {
    const t = String(fields[k] || '').match(/\b\d+(?:[.,]\d+)?\s?mg\b/i);
    if (t) issues.push({ champ: k, gravite: 'à revoir', message: `taux de nicotine cité (« ${t[0]} ») : il resterait écrit s'il disparaît du catalogue` });
  }
  for (const k of ['title', 'meta', 'presentation', 'texte_marque']) {
    if (/\bchine\b/i.test(String(fields[k] || ''))) issues.push({ champ: k, gravite: 'à revoir', message: 'cite la Chine : à garder pour la description et le tableau' });
  }
  // « Frais » ne veut pas dire menthe : le mot exige l'attribut, ou le nom du produit (retiré de v ci-dessus).
  if (!menthe) {
    const nom = norm(decode(productName));
    for (const k of ['title', 'meta', 'composition_aromatique', 'presentation', 'description']) {
      if (!/\bmenth(e|ol)\b/.test(nom) && /\bmenth(e|ol)\b/.test(norm(String(fields[k] || '')))) issues.push({ champ: k, gravite: 'à revoir', message: 'cite la menthe sans attribut Menthe' });
    }
  }
  // Le thème affiche « Eliquide {nom} - {marque} » : les écrire dans le H1 les doublerait.
  if (!multi) {
    if (/^\s*e-?\s?liquide/i.test(String(d.h1 || ''))) issues.push({ champ: 'h1', gravite: 'à revoir', message: 'commence par « e-liquide » : le site l\'ajoute déjà' });
    if (marques.some((m) => norm(String(d.h1 || '')).includes(norm(m)))) issues.push({ champ: 'h1', gravite: 'à revoir', message: 'cite la marque : le site l\'ajoute déjà' });
  }
  len('title', 25, 60);
  len('meta', 120, 155);
  if (!multi) len('composition_aromatique', 20, 60, 'mots');
  len('texte_marque', 30, 60, 'mots');
  len('presentation', 40, 80, 'mots');
  len('description', 15, 60, 'mots');
  return issues;
};

const factCheck = async (dossier, draft) => {
  const text = await claude({
    output_config: {
      effort: 'low',
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            affirmations: {
              type: 'array',
              items: {
                type: 'object',
                properties: { champ: { type: 'string' }, affirmation: { type: 'string' }, statut: { type: 'string', enum: ['sourcé', 'non sourcé', 'contradiction'] }, source: { type: 'string' } },
                required: ['champ', 'affirmation', 'statut', 'source'],
                additionalProperties: false,
              },
            },
          },
          required: ['affirmations'],
          additionalProperties: false,
        },
      },
    },
    messages: [{
      role: 'user',
      content: `Vérifie chaque affirmation factuelle des textes ci-dessous contre le dossier. Une affirmation est « sourcée » seulement si un attribut ou une description de la boutique la contient (cite lequel dans "source"). « non sourcé » si rien ne la confirme, « contradiction » si le dossier dit autre chose.

TEXTES :
${JSON.stringify({ title: draft.title, meta: draft.meta, h1: draft.h1, composition_aromatique: draft.composition_aromatique, texte_marque: draft.texte_marque, presentation: draft.presentation, description: draft.description }, null, 1)}

DOSSIER :
${JSON.stringify({ produit: dossier.produit, gouts: dossier.gouts, autres_formats: dossier.autres_formats, marque: { nom: dossier.marque?.nom, gamme: dossier.marque?.gamme, catalogue: dossier.marque?.catalogue, faits: dossier.marque?.faits } }, null, 1)}`,
    }],
  });
  return JSON.parse(text).affirmations;
};

// Correction : une affirmation non sourcée ou contredite est retirée ou ramenée
// à ce que le dossier dit. Le reste du texte ne bouge pas.
const revise = async (dossier, draft, faits) => {
  const bad = (faits || []).filter((f) => f.statut !== 'sourcé');
  if (!bad.length) return { draft, retirees: [] };
  const fields = ['title', 'meta', 'h1', 'composition_aromatique', 'texte_marque', 'presentation', 'description'];
  const schema = {
    type: 'object',
    properties: Object.fromEntries(fields.map((k) => [k, { type: 'string' }])),
    required: fields,
    additionalProperties: false,
  };
  const text = await claude({
    system: RULES,
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    messages: [{
      role: 'user',
      content: `Corrige ces textes : retire chaque affirmation listée ci-dessous, ou ramène-la exactement à ce que dit le dossier. Ne change rien d'autre (mêmes phrases, même longueur à peu près, mêmes mots-clés). Respecte les longueurs : title 60 caractères max, méta 120 à 155, composition 20 à 60 mots, texte de marque 30 à 60 mots.

AFFIRMATIONS À CORRIGER :
${JSON.stringify(bad, null, 1)}

TEXTES :
${JSON.stringify(Object.fromEntries(fields.map((k) => [k, draft[k]])), null, 1)}

DOSSIER :
${JSON.stringify({ produit: dossier.produit, gouts: dossier.gouts, autres_formats: dossier.autres_formats, marque: { nom: dossier.marque?.nom, gamme: dossier.marque?.gamme, catalogue: dossier.marque?.catalogue, faits: dossier.marque?.faits } }, null, 1)}`,
    }],
  });
  return { draft: { ...draft, ...JSON.parse(text) }, retirees: bad };
};

/* ─── Maillage interne (sans appel à Claude) ───────────── */

// Nom de la recette tel qu'affiché : « Red Astaire T-Juice 10ml » → « Red Astaire ».
const displayRecipe = (name, brand) => {
  let n = decode(name)
    .replace(/(^|\s)(concentr[ée]s?|ar[ôo]mes?|e-?liquides?)(?=\s|$)/gi, ' ')
    .replace(/(^|\s)(nic(otine)? ?salts?|sels? de nicotine)(?=\s|$)/gi, ' ')
    .replace(/\s+salts?\s*$/i, ' ') // « Strawberry Ice Salt » : Salt = le format, déjà dit dans l'ancre
    .replace(/\+? ?boosters?/gi, ' ')
    .replace(/(^|\s)\d+ ?ml(?=\s|$)/gi, ' ');
  for (const one of [brand].flat().filter(Boolean)) n = n.replace(new RegExp(`(^|\\s)(de |par |by )?${escapeRe(decode(one))}(?=\\s|$)`, 'i'), ' ');
  return n.replace(/\s+/g, ' ').trim().replace(/\s+salts?$/i, '').trim();
};

// Format d'après la catégorie : le 10 ml porte le nom seul (règle de la marge),
// les autres formats le nomment dans l'ancre.
const formatLabel = (product) => {
  const c = product.categories.join(' ');
  if (/concentre/.test(c)) return 'concentré';
  if (/sels-de-nicotine/.test(c)) return 'sel de nicotine';
  if (/grands-formats/.test(c)) return (decode(product.nom).match(/\d+ ?ml/i) || ['grand format'])[0].replace(' ', '');
  return null;
};

const cleanPath = (p) => pathOf(p).split(/[?#]/)[0].replace(/\/+$/, '') || '/';

// Liens d'une page du site vers `target` : null = page illisible (pare-feu, erreur).
const linksTo = async (sourcePath, target) => {
  try {
    const res = await axios.get(`${SITE}${sourcePath}`, {
      headers: { 'User-Agent': USER_AGENT }, timeout: 20000, maxContentLength: 5e6, responseType: 'text',
    });
    const html = String(res.data || '');
    // Un 200 n'est pas une preuve : une page de pare-feu répond 200 aussi.
    if (!/<html/i.test(html) || !/youvape/i.test(html) || /cf-challenge|Just a moment/i.test(html)) return null;
    const texte = [];
    let grille = false;
    for (const m of html.matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = (m[1].match(/href=["']([^"']+)["']/i) || [])[1];
      if (!href || cleanPath(href) !== target) continue;
      // Vignettes de la grille produits (titre, image, bouton) : ce n'est pas un lien dans le texte.
      if (/class=["'][^"']*(title-content|LoopProduct|product-image|add_to_cart|button)/i.test(m[1]) || !textOf(m[2])) grille = true;
      else texte.push(textOf(m[2]).slice(0, 80));
    }
    return { texte: [...new Set(texte)], grille };
  } catch {
    return null;
  }
};

// Où la fiche doit recevoir des liens, avec quelle ancre, et si c'est déjà fait.
// Les autres formats sont reliés automatiquement par le bloc « aussi vendu en » du site.
const loadMaillage = async (dossier, gsc) => {
  const p = dossier.produit;
  const multi = !!dossier.page_multi_gouts;
  const recette = multi ? decode(p.nom) : (displayRecipe(p.nom, brandNames(dossier.marque)) || dossier.recette);
  // Sans 10 ml dans la recette (gamme Fighter Fuel), le grand format porte le nom seul : lien sans contenance.
  const has10 = dossier.autres_formats.some((f) => f.categories.includes('eliquides-10ml') && !f.page_partagee);
  const fmt = multi || (/grands-formats/.test(p.categories.join(' ')) && !has10) ? null : formatLabel(p);
  // Dans l'ordre où on le dit : « concentré Heisenberg », « Red Astaire en sel de nicotine », « Red Astaire 50ml ».
  const ancre = !fmt ? recette
    : fmt === 'concentré' ? `concentré ${recette}`
      : fmt === 'sel de nicotine' ? `${recette} en sel de nicotine`
        : `${recette} ${fmt}`;
  const cible = p.chemin ? cleanPath(p.chemin) : null;
  const own = new Set([cible, ...dossier.autres_formats.map((f) => cleanPath(f.chemin))].filter(Boolean));
  const admin = (tax, id) => (id ? `/wp-admin/term.php?taxonomy=${tax}&tag_ID=${id}&post_type=product` : null);

  const sources = [];
  const m = dossier.marque;
  // Pas de tâche sur la page marque ni sur la catégorie : elles listent déjà leurs produits, et un lien écrit
  // à la main resterait mort si le produit était dépublié (décision du 09/11/2026).
  if (m?.gamme?.chemin) sources.push({ type: 'Page gamme', titre: m.gamme.nom, chemin: cleanPath(m.gamme.chemin), modifier: admin('pwb-brand', m.gamme.id), ou: 'description de la gamme' });
  // Gamme de la marque qui porte le nom de la recette (« Astaire Family » pour Red Astaire)
  // alors que la fiche n'y est pas rattachée : elle ne figure pas dans sa liste.
  if (m?.id && !m.gamme) {
    const mots = norm(dossier.recette).split(/\s+/).filter((w) => w.length >= 4);
    const enfants = await wpGet('wp/v2/pwb-brand', { parent: m.id, per_page: 100, _fields: 'id,name,link' }).catch(() => []);
    for (const g of enfants.filter((t) => mots.some((w) => norm(decode(t.name)).split(/\s+/).includes(w))).slice(0, 2)) {
      sources.push({ type: 'Page gamme', titre: decode(g.name), chemin: cleanPath(g.link), modifier: admin('pwb-brand', g.id), ou: `description de la gamme ; rattacher aussi la fiche à la marque « ${decode(g.name)} » pour qu'elle apparaisse dans sa liste` });
    }
  }
  // Pages du site qui sortent déjà sur les requêtes de la recette ou de la marque :
  // un lien depuis elles pèse plus qu'un lien depuis une page sans rapport.
  const seen = new Set(sources.map((s) => s.chemin));
  const gscPages = new Map();
  const recipeRows = Object.entries(gsc.requetes || {}).filter(([k]) => k !== 'marque_sans_recette').flatMap(([, rows]) => rows);
  for (const r of recipeRows) {
    for (const pg of r.pages) {
      const ch = cleanPath(pg.chemin);
      // Les autres fiches produit et les filtres de liste ne portent pas de texte à modifier.
      if (own.has(ch) || seen.has(ch) || /^\/produit\//.test(ch) || /\/filters\//.test(ch)) continue;
      const g = gscPages.get(ch) || { chemin: ch, impressions: 0, requetes: [] };
      g.impressions += pg.impressions;
      if (g.requetes.length < 3) g.requetes.push(r.requete);
      gscPages.set(ch, g);
    }
  }
  // Une page de liste de la marque consacrée à ce type de produit (« e-liquides JNR ») est une source
  // naturelle, même si elle sort sur la marque plutôt que sur la recette.
  const estPuff = p.categories.includes('puffs');
  for (const r of gsc.requetes?.marque_sans_recette || []) {
    for (const pg of r.pages) {
      const ch = cleanPath(pg.chemin);
      if (!/^\/etiquette-produit\//.test(ch) || !(estPuff ? /puff/ : /liquide/).test(ch) || seen.has(ch)) continue;
      const g = gscPages.get(ch) || { chemin: ch, impressions: 0, requetes: [] };
      g.impressions += pg.impressions;
      if (g.requetes.length < 3) g.requetes.push(r.requete);
      gscPages.set(ch, g);
    }
  }
  // Une ou deux impressions ne disent rien (magasin, article sur l'interdiction) ; une liste de puffs
  // n'a pas de raison de lier un e-liquide.
  const estConcentre = p.categories.some((c) => /concentre/.test(c));
  const pagesUtiles = [...gscPages.values()].filter((g) => g.impressions >= 5
    && (estPuff || !/^\/etiquette-produit\/[^/]*puff/.test(g.chemin))
    // Une page sur les concentrés ne doit pas lier un e-liquide prêt à vapoter (et inversement).
    && (estConcentre || !/concentr|aromes?-/.test(g.chemin)));
  for (const g of pagesUtiles.sort((a, b) => b.impressions - a.impressions).slice(0, 3)) {
    sources.push({ type: 'Page qui sort sur la recette', titre: g.requetes.join(', '), chemin: g.chemin, modifier: null, ou: 'texte de la page' });
  }

  const liens = [];
  const deja_lies = [];
  for (const s of sources) {
    const found = cible ? await linksTo(s.chemin, cible) : null;
    const editorial = (found?.texte || []).some((a) => norm(a) === norm(ancre));
    // Déjà dans la grille de la page : le lien existe et suit la publication du produit.
    // Lien déjà posé dans le texte, même avec une autre ancre : rien à faire non plus.
    if (found?.grille || found?.texte?.length) { deja_lies.push(s.chemin); continue; }
    liens.push({
      ...s,
      ancre,
      cible: cible || '(adresse de la fiche, une fois publiée)',
      etat: !cible ? 'apres_publication' : found === null ? 'non_verifie'
        : editorial ? 'fait' : found.texte.length ? 'autre_ancre' : 'a_faire',
      ancres_existantes: found?.texte || [],
      dans_la_grille: !!found?.grille,
    });
  }
  return {
    ancre,
    html: cible ? `<a href="${cible}/">${ancre}</a>` : null,
    liens,
    deja_lies,
    automatique: dossier.autres_formats.map((f) => f.chemin),
  };
};

/* ─── Chaîne complète ──────────────────────────────────── */

// `input` : id d'une fiche publiée, ou fiche complète envoyée par WordPress.
const run = async (input, { log = () => {} } = {}) => {
  Object.assign(usage, { input: 0, output: 0, searches: 0, fetches: 0, calls: 0, tool_errors: [] });
  const t0 = Date.now();
  log('dossier');
  const dossier = typeof input === 'object' ? await dossierFromPayload(input) : await loadDossier(input);
  log('search console');
  const gsc = await loadGsc(dossier);
  log('google ads');
  const ads = await loadAds(dossier, gsc);
  log('concurrents');
  const concurrents = await loadCompetitors(dossier);
  log('rédaction');
  const first = await generate({ ...dossier, search_console: gsc, google_ads: ads, concurrents });
  log('contrôles');
  const faits1 = await factCheck(dossier, first);
  const { draft, retirees } = await revise(dossier, first, faits1);
  // Après correction, on revérifie : ce qui reste non sourcé s'affiche dans l'admin.
  const faits = retirees.length ? await factCheck(dossier, draft) : faits1;
  const controles = lint(draft, dossier.produit.nom, { multi: !!dossier.page_multi_gouts, marques: brandNames(dossier.marque), menthe: Object.values(dossier.produit.attributs || {}).flat().some((v) => /menthe/i.test(v)) });
  // Règle : 3 fiches concurrentes lues au moins. Moins, c'est un résultat incomplet, et il faut le dire.
  const concurrentsLus = (concurrents.concurrents || []).filter((c) => c.lu).length;
  if (concurrentsLus < 3) controles.push({ champ: 'concurrents', gravite: 'à revoir', message: `${concurrentsLus} fiche(s) concurrente(s) lue(s) sur les 3 exigées` });
  log('maillage');
  const maillage = await loadMaillage(dossier, gsc).catch((e) => ({ erreur: e.message, liens: [] }));
  if (retirees.length) {
    draft.points_a_verifier = [
      ...(draft.points_a_verifier || []),
      ...retirees.map((f) => `Retiré du texte, faute de source : « ${f.affirmation} » (${f.champ}).`),
    ];
  }
  const cost = (usage.input * PRICE_IN + usage.output * PRICE_OUT) / 1e6 + usage.searches * WEB_SEARCH_PRICE;
  return {
    dossier, search_console: gsc, google_ads: ads, concurrents, brouillon: draft, controles, faits, maillage,
    cout: { ...usage, dollars: Math.round(cost * 1000) / 1000 },
    duree_s: Math.round((Date.now() - t0) / 1000),
    modele: MODEL,
    genere_le: new Date().toISOString(),
  };
};

/* ─── File des demandes (bouton de l'admin WordPress) ──── */

let tablesReady = false;
const ensureTables = async () => {
  if (tablesReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_writer_jobs (
      id           serial PRIMARY KEY,
      site         text NOT NULL,
      product_id   integer,
      product_name text,
      payload      jsonb NOT NULL,
      status       varchar(10) NOT NULL DEFAULT 'queued',
      step         text,
      result       jsonb,
      error        text,
      cost_usd     numeric(8,3),
      requested_by text,
      created_at   timestamp NOT NULL DEFAULT now(),
      started_at   timestamp,
      finished_at  timestamp
    );
    CREATE INDEX IF NOT EXISTS product_writer_jobs_product ON product_writer_jobs (site, product_id, created_at DESC);
  `);
  tablesReady = true;
};

// Un seul traitement à la fois : chaque fiche fait 3 appels longs à Claude.
let working = false;
const work = async () => {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const { rows } = await pool.query(
        `UPDATE product_writer_jobs SET status = 'running', started_at = now(), step = 'dossier'
         WHERE id = (SELECT id FROM product_writer_jobs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
         RETURNING id, payload`
      );
      if (!rows.length) break;
      const { id, payload } = rows[0];
      try {
        const result = await run(payload, {
          log: (step) => pool.query('UPDATE product_writer_jobs SET step = $2 WHERE id = $1', [id, step]).catch(() => {}),
        });
        await pool.query(
          `UPDATE product_writer_jobs SET status = 'done', step = NULL, result = $2, cost_usd = $3, finished_at = now() WHERE id = $1`,
          [id, JSON.stringify(result), result.cout.dollars]
        );
      } catch (error) {
        const msg = error.response?.data?.error?.message || error.message;
        console.error('[Fiche produit] demande', id, msg);
        await pool.query(`UPDATE product_writer_jobs SET status = 'error', error = $2, finished_at = now() WHERE id = $1`, [id, msg]);
      }
    }
  } finally {
    working = false;
  }
};

const createJob = async ({ site, product, requestedBy }) => {
  await ensureTables();
  if (!product || typeof product !== 'object' || !product.name) throw Object.assign(new Error('Fiche produit manquante'), { status: 400 });
  // Pas de doublon : une demande en cours sur la même fiche est renvoyée telle quelle.
  const open = await pool.query(
    `SELECT id FROM product_writer_jobs WHERE site = $1 AND product_id = $2 AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1`,
    [site, Number(product.id) || null]
  );
  if (open.rows.length) return { id: open.rows[0].id, existing: true };
  const { rows } = await pool.query(
    `INSERT INTO product_writer_jobs (site, product_id, product_name, payload, requested_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [site, Number(product.id) || null, String(product.name).slice(0, 300), JSON.stringify(product), requestedBy || null]
  );
  setImmediate(() => work().catch((e) => console.error('[Fiche produit] file', e.message)));
  return { id: rows[0].id, existing: false };
};

const getJob = async (site, id) => {
  await ensureTables();
  const { rows } = await pool.query(
    `SELECT id, product_id, product_name, status, step, result, error, cost_usd, requested_by, created_at, started_at, finished_at,
            (SELECT COUNT(*)::int FROM product_writer_jobs q WHERE q.status = 'queued' AND q.id < j.id) AS ahead
     FROM product_writer_jobs j WHERE site = $1 AND id = $2`,
    [site, id]
  );
  return rows[0] || null;
};

// Au démarrage : une demande restée « running » (redémarrage du backend) repart.
const resumeJobs = async () => {
  await ensureTables();
  await pool.query(`UPDATE product_writer_jobs SET status = 'queued', step = NULL WHERE status = 'running'`);
  work().catch((e) => console.error('[Fiche produit] reprise', e.message));
};

module.exports = {
  usage,
  run, readCompetitorPage, loadDossier, dossierFromPayload, loadGsc, loadAds, loadCompetitors, loadMaillage, generate, lint, factCheck, revise, recipeKey,
  createJob, getJob, resumeJobs,
};
