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
    .replace(/[   ]/g, ' ')       // espaces insécables / fines
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/Ω|Ω/g, ' ohm ')          // Ω → ohm
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokens significatifs. Les nombres sont canonisés (0.70 → 0.7, 1.00 → 1) pour
 * que « 1.00 Ω » et « 1.0 ohm » tombent sur le même token : dans ce catalogue,
 * la valeur en ohms est LE discriminant entre deux références jumelles.
 */
function tokenize(str) {
  const out = [];
  for (const raw of normalize(str).split(' ')) {
    if (!raw) continue;
    if (/^[0-9]*\.?[0-9]+$/.test(raw)) {
      const n = Number(raw);
      if (!Number.isNaN(n)) { out.push(String(n)); continue; }
    }
    if (raw.length < 2 || STOPWORDS.has(raw)) continue;
    out.push(raw);
  }
  return [...new Set(out)];
}

/** Nombre d'unités annoncé par le titre : « Pack 5 … », « Lot de 3 … ». */
function packFromTitle(title) {
  const m = normalize(title).match(/\b(?:pack|lot|set|boite|boite de)\s*(?:de\s*)?([0-9]{1,2})\b/);
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
  for (const [t, c] of df) idf.set(t, Math.log(1 + n / c));
  return { postings, idf };
}

/**
 * Score de recouvrement pondéré IDF, dans le sens boutique → site : quelle part
 * du poids informatif du nom de caisse se retrouve dans le titre du site.
 * Asymétrique volontairement — le titre site est souvent plus verbeux.
 */
function scoreMatch(nxTokens, wcTokenSet, idf) {
  let total = 0;
  let shared = 0;
  for (const t of nxTokens) {
    const w = idf.get(t) || 1;
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
  const { postings, idf } = buildIndex(wcProducts);

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
          return { id, score: w ? scoreMatch(nxTokens, w.tokenSet, idf) : 0 };
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
        const sc = scoreMatch(nxTokens, w.tokenSet, idf);
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
      const byTitle = w ? packFromTitle(w.post_title) : null;
      const byRatio = w ? packFromCostRatio(w.cost, nx.cost) : null;
      if (byTitle) {
        packQty = byTitle;
        packSource = 'title';
        if (byRatio && byRatio !== byTitle) {
          packWarning = `Titre « pack ${byTitle} » mais le rapport des coûts indique ${byRatio}`;
        }
      } else if (byRatio && byRatio > 1) {
        packQty = byRatio;
        packSource = 'cost_ratio';
        packWarning = `Déduit du rapport des coûts (${byRatio}×), non confirmé par le titre`;
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
