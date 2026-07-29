/**
 * Découverte automatique des produits d'une marque chez les concurrents, puis
 * matching aux produits Youvape — au niveau MODÈLE (une entrée par modèle).
 *
 * Sources :
 *  - levapoteur-discount : page de recherche PrestaShop (fetch direct)
 *  - cigaretteelec       : page marque PrestaShop (via ScraperAPI)
 *  - Le Petit Vapoteur   : API Algolia publique (recherche par marque)
 *
 * Respecte les rejets : un (concurrent, produit) supprimé par l'utilisateur
 * n'est plus proposé comme matché.
 */
const pool = require('../config/database');
const { fetchPage } = require('./competitorFetchService');
const { searchLpvAll } = require('./lpvSearchService');
const competitorModel = require('../models/competitorModel');

const MAX_PAGES = 8;
const MATCH_THRESHOLD = 0.70;
const LPV = 'Le Petit Vapoteur';

const COMPETITORS = {
  'levapoteur-discount': {
    listing: (brand, page) => `https://www.levapoteur-discount.fr/recherche?controller=search&s=${encodeURIComponent(brand)}&p=${page}`,
    productRe: /https:\/\/www\.levapoteur-discount\.fr\/[a-z0-9-]+\/(\d+)-([a-z0-9-]+)/gi,
    requireBrandInSlug: true,
  },
  'cigaretteelec': {
    listing: (brand, page) => `https://www.cigaretteelec.fr/marques/${brand.toLowerCase()}?p=${page}`,
    productRe: /https:\/\/www\.cigaretteelec\.fr\/p\/(\d+)-([a-z0-9-]+)\.html/gi,
    requireBrandInSlug: false,
  },
};

const STOP = new Set(['puff', 'jnr', 'pod', 'the', 'a', 'et', 'edition', 'special']);
const FILLER = new Set(['pour', 'pas', 'cher', 'chers', 'chere', 'cheres', 'le', 'la', 'les', 'de', 'des', 'du', 'avec', 'lot', 'version', 'series']);
const COLORS = new Set(['noir', 'black', 'blanc', 'white', 'rouge', 'red', 'bleu', 'blue', 'vert', 'green', 'jaune', 'yellow',
  'gris', 'grey', 'gray', 'gunmetal', 'argent', 'silver', 'gold', 'rose', 'pink', 'violet', 'purple', 'orange', 'marron',
  'brown', 'rainbow', 'turquoise', 'cyan', 'bronze', 'chrome', 'transparent', 'clear', 'camo', 'fuchsia', 'beige', 'khaki', 'kaki']);
const NOISE = /(drip-tip|embout|filtre|papier|cable|resistance|batterie|chargeur|pyrex|-vide-|vides-|coil)/i;

const isCapNorm = (t) => /^\d+k$/.test(t);
const normCap = (t) => {
  let m = t.match(/^(\d+)000$/); if (m) return m[1] + 'k';
  m = t.match(/^(\d{4,6})$/); if (m) return Math.round(parseInt(m[1]) / 1000) + 'k';
  m = t.match(/^(\d+)k$/); if (m) return m[1] + 'k';
  return t;
};
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function tokenize(str) {
  const raw = str.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t === 'mg' || t === 'ml') continue;
    if (/^\d+$/.test(t) && (raw[i + 1] === 'mg' || raw[i + 1] === 'ml')) continue;
    out.push(t);
  }
  return out;
}
function significantTokens(str, brandLc) {
  return tokenize(str)
    .filter((t) => t !== brandLc && !STOP.has(t) && !COLORS.has(t) && !FILLER.has(t))
    .map(normCap);
}
function modelFromSlug(slug, brandLc) {
  let toks = significantTokens(slug, brandLc);
  const capIdx = toks.findIndex(isCapNorm);
  const model = capIdx >= 0 ? toks.slice(0, capIdx + 1) : toks;
  const key = model.slice().sort().join('-');
  return { key, label: titleCase(model.join(' ')), tokens: model };
}
function modelFromTitle(title, brandLc) {
  const toks = significantTokens(title, brandLc);
  const capIdx = toks.findIndex(isCapNorm);
  return capIdx >= 0 ? toks.slice(0, capIdx + 1) : toks;
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b);
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  const union = new Set([...A, ...B]).size;
  return union ? inter / union : 0;
};
const bigrams = (s) => { const b = []; for (let i = 0; i < s.length - 1; i++) b.push(s.slice(i, i + 2)); return b; };
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return a === b ? 1 : 0;
  const bag = new Map();
  for (const g of A) bag.set(g, (bag.get(g) || 0) + 1);
  let inter = 0;
  for (const g of B) { const c = bag.get(g) || 0; if (c > 0) { inter++; bag.set(g, c - 1); } }
  return (2 * inter) / (A.length + B.length);
}
const sortedConcat = (tokens) => tokens.slice().sort().join('');
const similarity = (a, b) => Math.max(jaccard(a, b), dice(sortedConcat(a), sortedConcat(b)));

// ─── Collecte des modèles selon la source ────────────────────────
async function collectFromListing(competitor, brand, brandLc) {
  const cfg = COMPETITORS[competitor];
  const models = new Map();
  const seen = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetchPage(cfg.listing(brand, page));
    if (res.blocked || !res.html) {
      if (page === 1) throw new Error(res.error || `Listing inaccessible (HTTP ${res.status})`);
      break;
    }
    let added = 0, m;
    cfg.productRe.lastIndex = 0;
    while ((m = cfg.productRe.exec(res.html)) !== null) {
      const url = m[0], slug = m[2];
      if (seen.has(url)) continue;
      seen.add(url); added++;
      if (NOISE.test(slug)) continue;
      if (cfg.requireBrandInSlug && !slug.includes(brandLc)) continue;
      const model = modelFromSlug(slug, brandLc);
      if (!model.tokens.length) continue;
      if (!models.has(model.key)) models.set(model.key, { ...model, url, name: slug.replace(/-/g, ' ') });
    }
    if (added === 0) break;
  }
  return models;
}

async function collectFromLpv(brand, brandLc) {
  const models = new Map();
  for (let page = 0; page < 6; page++) {
    let hits = [], nbPages = 1;
    try { ({ hits, nbPages } = await searchLpvAll(brand, { hitsPerPage: 100, page })); }
    catch (e) { if (page === 0) throw new Error(`Algolia LPV: ${e.message}`); break; }
    for (const h of hits) {
      const url = h.current_product_link;
      if (!url) continue;
      const slug = (h.link_rewrite || (h.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      if (NOISE.test(slug)) continue;
      if (!slug.includes(brandLc)) continue; // on garde les produits de la marque
      const model = modelFromSlug(slug, brandLc);
      if (!model.tokens.length) continue;
      if (!models.has(model.key)) models.set(model.key, { ...model, url, name: (h.name || slug.replace(/-/g, ' ')) });
    }
    if (page + 1 >= nbPages) break;
  }
  return models;
}

async function loadYouvapeModels(brand) {
  const brandLc = brand.toLowerCase();
  const { rows } = await pool.query(
    `SELECT p.sku AS parent_sku, p.post_title, COALESCE(v.sku, p.sku) AS repr_sku
     FROM products p
     LEFT JOIN LATERAL (
       SELECT sku FROM products WHERE sku LIKE p.sku || '-%'
       ORDER BY discounted_price NULLS LAST LIMIT 1
     ) v ON TRUE
     WHERE p.brand ILIKE '%' || $1 || '%'
       AND p.post_status = 'publish' AND p.product_type = 'variable'`,
    [brand]
  );
  return rows.map((r) => ({ repr_sku: r.repr_sku, title: r.post_title, tokens: modelFromTitle(r.post_title, brandLc) }));
}

function bestMatch(compTokens, youvapeModels) {
  let best = { score: 0, repr_sku: null, title: null };
  for (const y of youvapeModels) {
    if (!y.tokens.length) continue;
    const s = similarity(compTokens, y.tokens);
    if (s > best.score) best = { score: s, repr_sku: y.repr_sku, title: y.title };
  }
  return best;
}

async function runDiscovery(competitor, brand = 'JNR') {
  const brandLc = brand.toLowerCase();

  let models;
  if (competitor === LPV) models = await collectFromLpv(brand, brandLc);
  else if (COMPETITORS[competitor]) models = await collectFromListing(competitor, brand, brandLc);
  else throw new Error(`Découverte non supportée pour "${competitor}"`);

  const youvape = await loadYouvapeModels(brand);
  const rejected = await competitorModel.getRejections();

  let inserted = 0;
  const out = [];
  for (const model of models.values()) {
    const match = bestMatch(model.tokens, youvape);
    const parent = match.repr_sku ? String(match.repr_sku).split('-')[0] : null;
    const isRejected = parent && rejected.has(`${competitor}||${parent}`);
    const matched = match.score >= MATCH_THRESHOLD && !isRejected;
    await pool.query(
      `INSERT INTO competitor_match_suggestions
         (competitor, brand, model_key, model_label, representative_url, representative_name,
          matched_sku, matched_title, match_score, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
       ON CONFLICT (competitor, model_key) DO UPDATE SET
         model_label = EXCLUDED.model_label,
         representative_url = EXCLUDED.representative_url,
         representative_name = EXCLUDED.representative_name,
         matched_sku = CASE WHEN competitor_match_suggestions.status = 'pending'
                            THEN EXCLUDED.matched_sku ELSE competitor_match_suggestions.matched_sku END,
         matched_title = CASE WHEN competitor_match_suggestions.status = 'pending'
                              THEN EXCLUDED.matched_title ELSE competitor_match_suggestions.matched_title END,
         match_score = EXCLUDED.match_score, updated_at = NOW()`,
      [competitor, brand, model.key, model.label, model.url, model.name,
       matched ? match.repr_sku : null, matched ? match.title : null, Number(match.score.toFixed(3))]
    );
    inserted++;
    out.push({ model: model.label, matched_sku: matched ? match.repr_sku : null, matched_title: matched ? match.title : null, score: Number(match.score.toFixed(2)) });
  }
  return { competitor, brand, discovered: models.size, inserted, models: out };
}

module.exports = { runDiscovery, modelFromSlug, modelFromTitle, similarity };
