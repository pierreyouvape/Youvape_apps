/**
 * Rapprochement produits caisse (Nextore) <-> site (WooCommerce).
 *
 * Le moteur PROPOSE, il ne décide pas : tout atterrit en `pending` dans
 * nextore_product_links et n'a d'effet qu'une fois approuvé à la main. Les EAN
 * de la caisse ne sont pas fiables (codes internes « 202 », « 123456 », EAN
 * recyclés d'un produit à l'autre), d'où la file de validation.
 *
 * Deux passes :
 *   1. EAN exact via product_barcodes (le barcode Nextore peut en contenir
 *      plusieurs séparés par « ; »)
 *   2. Similarité de nom pondérée IDF, sur les produits WC publiés
 *
 * `pack_qty` = nombre d'unités BOUTIQUE dans un produit SITE (résistances
 * vendues à l'unité en boutique, en pack de 3/5 sur le site). Déduit du titre
 * WC (« Pack 5 … ») puis recoupé avec le ratio des coûts ; toute incohérence
 * est signalée dans `pack_warning` au lieu d'être appliquée en silence.
 */

const pool = require('../config/database');

// --- Normalisation ---------------------------------------------------------

// Entités HTML qu'on croise dans les titres WooCommerce.
const ENTITIES = { '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&#039;': "'", '&apos;': "'" };

/** Mots vides du domaine : présents partout, ils ne discriminent rien. */
const STOPWORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'ou', 'a', 'au', 'aux', 'en', 'par',
  'pour', 'avec', 'sur', 'ml', 'mg', 'the', 'of',
]);

/**
 * Minuscules + sans accent + sans ponctuation. Gère l'espace INSÉCABLE (U+00A0)
 * que WooCommerce insère après « Pack » — sans ça, « Pack 5 » n'est pas détecté.
 */
function normalize(str) {
  if (!str) return '';
  let s = String(str);
  for (const [ent, ch] of Object.entries(ENTITIES)) s = s.split(ent).join(ch);
  return s
    .replace(/[\u00A0\u202F\u2009]/g, ' ')             // espaces insécables / fines
    .normalize('NFD').replace(/[\u0300-\u036F]/g, '')   // accents
    // Ω AVANT le passage en minuscules : toLowerCase() transforme Ω en ω, que le
    // filtre [a-z0-9.] jetterait ensuite — la valeur en ohms serait perdue.
    .replace(/[\u03A9\u2126\u03C9]/g, ' ohm ')
    // Virgule décimale AVANT le nettoyage de la ponctuation : « 0,80 Ω » des
    // titres WooCommerce donnerait sinon deux tokens « 0 » et « 80 ».
    .replace(/([0-9]),([0-9])/g, '$1.$2')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unités du domaine : collées au nombre qui les précède (voir tokenize). */
const UNITS = new Set(['ml', 'mg', 'ohm', 'ohms', 'mah', 'mm', 'cm', 'ga', 'w', 'v', 'g', 'kg', 'l', 'pcs']);

/** « 1.00 » et « 1.0 » doivent donner le même token. */
function canonNum(x) {
  const n = Number(x);
  return Number.isNaN(n) ? x : String(n);
}

/**
 * Tokens significatifs.
 *
 * Un nombre est TOUJOURS recollé à son unité (« 10 ml » et « 10ml » → `10ml`,
 * « 0,80 Ω » → `0.8ohm`). Sans ça le « 10 » de « 10 ml » entre en collision
 * avec le « 10 » de « Pack 10 Coils » et fabrique des faux positifs — c'est
 * exactement ce qui rapprochait un e-liquide d'un pack de résistances.
 * Les nombres nus (valeurs en ohms sans unité, millésimes) sont conservés :
 * dans ce catalogue ils séparent deux références jumelles.
 */
function tokenize(str) {
  // 1. éclater « 50ml » en (50, ml) pour n'avoir qu'une forme à traiter
  const parts = [];
  for (const w of normalize(str).split(' ')) {
    if (!w) continue;
    const m = w.match(/^([0-9]*\.?[0-9]+)([a-z]+)$/);
    if (m && UNITS.has(m[2])) parts.push(m[1], m[2]);
    else parts.push(w);
  }
  // 2. recoller nombre + unité, filtrer le reste
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const w = parts[i];
    if (/^[0-9]*\.?[0-9]+$/.test(w)) {
      const unit = parts[i + 1];
      if (unit && UNITS.has(unit)) {
        out.push(canonNum(w) + (unit === 'ohms' ? 'ohm' : unit));
        i += 1;
      } else {
        out.push(canonNum(w));
      }
      continue;
    }
    if (w.length < 2 || STOPWORDS.has(w)) continue;
    out.push(w);
  }
  return [...new Set(out)];
}

/**
 * Nombre d'unités annoncé par un libellé : « Pack 5 … », « Pack 2X … »,
 * « Pack X4 … », « Pack de 42 … », « Set 30 … ». Les deux catalogues écrivent
 * la même chose de six façons différentes.
 */
function packFromTitle(title) {
  const m = normalize(title).match(/\b(?:pack|lot|set|boite)\s*(?:de\s*)?(?:x\s*)?([0-9]{1,2})\s*x?\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 2 && n <= 50 ? n : null;
}

/**
 * Nombre d'unités déduit du rapport des coûts (coût site / coût boutique).
 * On n'accepte que si le rapport tombe à ±12 % d'un entier : c'est un contrôle,
 * pas une estimation.
 */
function packFromCostRatio(wcCost, nxCost) {
  if (!wcCost || !nxCost || nxCost <= 0 || wcCost <= 0) return null;
  const ratio = wcCost / nxCost;
  const n = Math.round(ratio);
  if (n < 1 || n > 20) return null;
  if (Math.abs(ratio - n) > 0.12 * n) return null;
  return n;
}

/** EAN exploitables d'un champ barcode Nextore (multi-valué, avec du bruit). */
function splitBarcodes(barcode) {
  if (!barcode) return [];
  return String(barcode)
    .split(/[;,\s]+/)
    .map((b) => b.trim())
    .filter((b) => /^[0-9]{8,14}$/.test(b));
}

// --- Moteur ----------------------------------------------------------------

/**
 * Index inversé token → produits WC. Les tokens trop fréquents (présents dans
 * plus de `maxDf` produits) ne servent pas de point d'entrée : ils feraient
 * exploser le nombre de candidats sans rien discriminer.
 */
function buildIndex(wcProducts, maxDf = 400) {
  const df = new Map();
  for (const p of wcProducts) {
    for (const t of p.tokens) df.set(t, (df.get(t) || 0) + 1);
  }
  const postings = new Map();
  for (const p of wcProducts) {
    for (const t of p.tokens) {
      if (df.get(t) > maxDf) continue;
      if (!postings.has(t)) postings.set(t, []);
      postings.get(t).push(p);
    }
  }
  const n = wcProducts.length || 1;
  const idf = new Map();
  let maxIdf = 1;
  for (const [t, c] of df) {
    const v = Math.log(1 + n / c);
    idf.set(t, v);
    if (v > maxIdf) maxIdf = v;
  }
  // Un token du nom de caisse ABSENT du catalogue site est le plus rare de tous.
  // Lui donner un poids faible inverserait le score : un nom propre inconnu
  // (« SCAFAYA ») pèserait moins qu'un « pack » générique, et la ligne serait
  // rapprochée sur ses seuls mots creux.
  return { postings, idf, maxIdf };
}

/**
 * Score de recouvrement pondéré IDF, dans le sens boutique → site : quelle part
 * du poids informatif du nom de caisse se retrouve dans le titre du site.
 * Asymétrique volontairement — le titre site est souvent plus verbeux.
 */
function scoreMatch(nxTokens, wcTokenSet, idf, maxIdf = 1) {
  let total = 0;
  let shared = 0;
  for (const t of nxTokens) {
    const w = idf.get(t) ?? maxIdf;
    total += w;
    if (wcTokenSet.has(t)) shared += w;
  }
  return total > 0 ? shared / total : 0;
}

const NAME_MIN_SCORE = 0.45;   // en dessous, on ne propose rien
const NAME_TOP_N = 5;          // pistes conservées dans `candidates`

/**
 * Recalcule les propositions. NE TOUCHE JAMAIS aux liens `approved` /
 * `rejected` : une décision humaine ne se fait pas écraser par un batch.
 * Renvoie un compte-rendu.
 */
async function runMatching({ onlyInStock = true } = {}) {
  const started = Date.now();

  // Produits caisse à rapprocher (par défaut : ceux qui portent du stock)
  const { rows: nxRows } = await pool.query(
    `SELECT p.product_id, p.name, p.code, p.barcode, p.cost::float AS cost,
            COALESCE(st.stock, 0)::float AS stock
     FROM nextore_products p
     LEFT JOIN LATERAL (
       SELECT SUM(ABS(s.stock)) AS stock FROM nextore_stock s WHERE s.product_id = p.product_id
     ) st ON true
     WHERE COALESCE(p.status, '') <> 'deleted'
       AND (p.name IS NULL OR p.name NOT ILIKE 'produit non cr%')
       ${onlyInStock ? 'AND COALESCE(st.stock, 0) <> 0' : ''}`
  );

  // Produits site candidats : publiés, hors parents variables (doublons de titre)
  const { rows: wcRows } = await pool.query(
    `SELECT id, sku, post_title, product_type,
            COALESCE(computed_cost, wc_cog_cost)::float AS cost
     FROM products
     WHERE post_status = 'publish'
       AND product_type IN ('simple', 'variation', 'woosb')
       AND COALESCE(post_title, '') <> ''`
  );

  // Décisions humaines déjà prises, à préserver
  const { rows: lockedRows } = await pool.query(
    `SELECT nx_product_id FROM nextore_product_links WHERE status IN ('approved', 'rejected')`
  );
  const locked = new Set(lockedRows.map((r) => r.nx_product_id));

  // Index EAN → produits WC
  const { rows: bcRows } = await pool.query(
    `SELECT pb.barcode, pb.product_id FROM product_barcodes pb
     JOIN products pr ON pr.id = pb.product_id`
  );
  const eanIndex = new Map();
  for (const r of bcRows) {
    if (!eanIndex.has(r.barcode)) eanIndex.set(r.barcode, new Set());
    eanIndex.get(r.barcode).add(r.product_id);
  }

  const wcById = new Map();
  const wcProducts = wcRows.map((p) => {
    const item = { ...p, tokens: tokenize(p.post_title), tokenSet: null };
    item.tokenSet = new Set(item.tokens);
    wcById.set(p.id, item);
    return item;
  });
  const { postings, idf, maxIdf } = buildIndex(wcProducts);

  const stats = { scanned: 0, ean: 0, eanAmbiguous: 0, name: 0, none: 0, skippedLocked: 0 };
  const upserts = [];

  for (const nx of nxRows) {
    if (locked.has(nx.product_id)) { stats.skippedLocked += 1; continue; }
    stats.scanned += 1;

    const nxTokens = tokenize(nx.name);
    let wcId = null;
    let method = null;
    let score = null;
    let candidates = [];

    // --- Passe 1 : EAN ---
    const eans = splitBarcodes(nx.barcode);
    const hits = new Set();
    for (const e of eans) {
      for (const id of eanIndex.get(e) || []) hits.add(id);
    }
    if (hits.size === 1) {
      wcId = [...hits][0];
      method = 'ean';
      score = 1;
    } else if (hits.size > 1) {
      // Départage par le nom, les autres restent proposés comme alternatives
      const ranked = [...hits]
        .map((id) => {
          const w = wcById.get(id);
          return { id, score: w ? scoreMatch(nxTokens, w.tokenSet, idf, maxIdf) : 0 };
        })
        .sort((a, b) => b.score - a.score);
      wcId = ranked[0].id;
      method = 'ean_ambiguous';
      score = 0.8;
      candidates = ranked.slice(0, NAME_TOP_N).map((c) => ({ wc_product_id: c.id, score: Number(c.score.toFixed(3)), via: 'ean' }));
    }

    // --- Passe 2 : nom ---
    if (!wcId && nxTokens.length) {
      const seen = new Map();
      for (const t of nxTokens) {
        for (const w of postings.get(t) || []) {
          if (!seen.has(w.id)) seen.set(w.id, w);
        }
      }
      const ranked = [];
      for (const w of seen.values()) {
        const sc = scoreMatch(nxTokens, w.tokenSet, idf, maxIdf);
        if (sc >= NAME_MIN_SCORE) ranked.push({ id: w.id, score: sc });
      }
      ranked.sort((a, b) => b.score - a.score);
      if (ranked.length) {
        wcId = ranked[0].id;
        method = 'name';
        score = Number(ranked[0].score.toFixed(3));
        candidates = ranked.slice(0, NAME_TOP_N).map((c) => ({ wc_product_id: c.id, score: Number(c.score.toFixed(3)), via: 'name' }));
      }
    }

    // --- pack_qty : titre, recoupé par le ratio de coût ---
    let packQty = 1;
    let packSource = 'default';
    let packWarning = null;
    if (wcId) {
      const w = wcById.get(wcId);
      // pack_qty est un RAPPORT entre les deux conditionnements, pas le compte
      // affiché par le site : la caisse vend elle aussi des packs (« PACK 2
      // CARTOUCHES »). Un pack de 2 des deux côtés = même granularité = 1.
      const nxUnits = packFromTitle(nx.name) || 1;
      const wcUnits = (w ? packFromTitle(w.post_title) : null) || 1;
      const byRatio = w ? packFromCostRatio(w.cost, nx.cost) : null;

      if (wcUnits % nxUnits === 0 && wcUnits >= nxUnits) {
        packQty = wcUnits / nxUnits;
        packSource = wcUnits === 1 && nxUnits === 1 ? 'default' : 'title';
      } else {
        // Conditionnements non multiples (caisse par 3, site par 5) : pack_qty
        // est entier en base, on ne devine pas — l'arbitrage revient à l'humain.
        packWarning = `Conditionnements non multiples : caisse par ${nxUnits}, site par ${wcUnits}`;
      }

      // Le ratio de coût ne sert QU'À CONTRÔLER. Le déduire serait circulaire :
      // c'est justement le coût caisse qui est faux, un écart de prix
      // deviendrait un faux pack.
      if (!packWarning && byRatio && byRatio !== packQty) {
        packWarning = packSource === 'title'
          ? `Conditionnements : ×${packQty} attendu, mais le rapport des coûts indique ×${byRatio}`
          : `Le coût site vaut ${byRatio}× le coût caisse : pack non déclaré ou tarif caisse à revoir ?`;
      }
    }

    if (method === 'ean') stats.ean += 1;
    else if (method === 'ean_ambiguous') stats.eanAmbiguous += 1;
    else if (method === 'name') stats.name += 1;
    else stats.none += 1;

    upserts.push([
      nx.product_id, wcId, packQty, method, score,
      candidates.length ? JSON.stringify(candidates) : null,
      packSource, packWarning,
    ]);
  }

  // Écriture : seules les lignes `pending` sont (ré)écrites, cf. WHERE final
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cols = ['nx_product_id', 'wc_product_id', 'pack_qty', 'match_method', 'score', 'candidates', 'pack_source', 'pack_warning'];
    const perRow = cols.length;
    const chunkSize = Math.floor(60000 / perRow);
    for (let i = 0; i < upserts.length; i += chunkSize) {
      const chunk = upserts.slice(i, i + chunkSize);
      const values = [];
      const placeholders = chunk.map((row, r) => {
        const ph = row.map((_, c) => `$${r * perRow + c + 1}${cols[c] === 'candidates' ? '::jsonb' : ''}`);
        values.push(...row);
        return `(${ph.join(', ')})`;
      });
      await client.query(
        `INSERT INTO nextore_product_links (${cols.join(', ')})
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (nx_product_id) DO UPDATE SET
           wc_product_id = EXCLUDED.wc_product_id,
           pack_qty      = EXCLUDED.pack_qty,
           match_method  = EXCLUDED.match_method,
           score         = EXCLUDED.score,
           candidates    = EXCLUDED.candidates,
           pack_source   = EXCLUDED.pack_source,
           pack_warning  = EXCLUDED.pack_warning,
           updated_at    = NOW()
         WHERE nextore_product_links.status = 'pending'`,
        values
      );
    }
    await client.query(
      `INSERT INTO app_config (config_key, config_value, updated_at)
       VALUES ('nextore_last_match_at', NOW()::text, NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = NOW()::text, updated_at = NOW()`
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { ...stats, durationMs: Date.now() - started };
}

module.exports = {
  runMatching,
  normalize,
  tokenize,
  packFromTitle,
  packFromCostRatio,
  splitBarcodes,
};
