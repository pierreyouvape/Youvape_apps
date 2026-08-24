/**
 * Rapprochement caisse <-> site : lecture / arbitrage de la file de validation.
 *
 * Le moteur (services/nextoreMatchService) remplit `nextore_product_links` en
 * `pending` ; ce modèle sert l'écran de validation et applique les décisions.
 * Un lien n'a d'effet sur les coûts qu'une fois `approved`.
 *
 * COÛT ALIGNÉ = coût du produit SITE (computed_cost, à défaut wc_cog_cost)
 * divisé par `pack_qty` : le site vend des packs de 5 résistances, la boutique
 * les compte à l'unité.
 */

const pool = require('../config/database');

/** Coût de référence du site : le PMP calculé, à défaut le coût WooCommerce. */
const WC_COST = 'COALESCE(pr.computed_cost, pr.wc_cog_cost)';

/** Coût unitaire boutique dérivé du site (SQL réutilisé partout). */
const ALIGNED_COST = `(${WC_COST} / NULLIF(l.pack_qty, 0))`;

/** Dérive du tarif caisse, à l'unité puis en %. */
const ECART_UNIT = `(${ALIGNED_COST} - p.cost)`;
const ECART_PCT = `(${ECART_UNIT} / NULLIF(p.cost, 0))`;
/**
 * Ce que l'écart pèse VRAIMENT sur la valeur de stock. C'est le bon critère de
 * tri : 300 % de dérive sur une unité à 0,20 € ne coûte rien, 20 % sur 500
 * unités change le total. Le tri par confiance ne dit rien de l'enjeu.
 */
const ECART_VALEUR = `(st.stock * ${ECART_UNIT})`;

/** Tris autorisés (jamais d'expression venue du client dans le ORDER BY). */
const SORTS = {
  impact:     `ABS(${ECART_VALEUR})`,
  ecart_pct:  `ABS(${ECART_PCT})`,
  stock:      'ABS(COALESCE(st.stock, 0))',
  cost:       'p.cost',
  aligned:    ALIGNED_COST,
  name:       'p.name',
  score:      'l.score',
};
/** Tri par défaut : les pistes les plus sûres d'abord, à enjeu décroissant. */
const SORT_CONFIDENCE = `(l.match_method = 'ean') DESC, l.score DESC NULLS LAST, ABS(COALESCE(st.stock, 0)) DESC`;

/**
 * File de validation. `shop` (1|2) restreint aux produits portant du stock dans
 * cette boutique et fait remonter ce stock, mais les liens eux-mêmes sont
 * GLOBAUX : le catalogue Nextore est commun aux deux boutiques.
 */
async function listLinks(opts = {}) {
  const params = [];
  const where = [];

  const status = opts.status && opts.status !== 'all' ? String(opts.status) : null;
  if (status === 'unmatched') {
    where.push(`l.status = 'pending' AND l.wc_product_id IS NULL`);
  } else if (status) {
    params.push(status);
    where.push(`l.status = $${params.length}`);
    if (status === 'pending') where.push('l.wc_product_id IS NOT NULL');
  }

  if (opts.method && opts.method !== 'all') {
    params.push(String(opts.method));
    where.push(`l.match_method = $${params.length}`);
  }
  if (opts.search) {
    params.push(`%${String(opts.search).trim()}%`);
    where.push(`(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length}
                 OR p.barcode ILIKE $${params.length} OR pr.post_title ILIKE $${params.length})`);
  }
  if (opts.onlyWarnings) where.push('l.pack_warning IS NOT NULL');

  // Seuils « ceux qui posent problème » : dérive en % et/ou poids en euros
  const minPct = Number(opts.minEcartPct);
  if (Number.isFinite(minPct) && minPct > 0) {
    params.push(minPct / 100);
    where.push(`ABS(${ECART_PCT}) >= $${params.length}`);
  }
  const minImpact = Number(opts.minImpact);
  if (Number.isFinite(minImpact) && minImpact > 0) {
    params.push(minImpact);
    where.push(`ABS(${ECART_VALEUR}) >= $${params.length}`);
  }

  let shopJoin = 'LEFT JOIN LATERAL (SELECT SUM(ABS(stock)) AS stock FROM nextore_stock s WHERE s.product_id = p.product_id) st ON true';
  if (opts.shopId) {
    params.push(Number(opts.shopId));
    shopJoin = `JOIN LATERAL (SELECT s.stock FROM nextore_stock s
                  WHERE s.product_id = p.product_id AND s.warehouse_id = $${params.length}) st ON true`;
    where.push('st.stock <> 0');
  }

  const dir = String(opts.dir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const orderBy = SORTS[opts.sort]
    ? `${SORTS[opts.sort]} ${dir} NULLS LAST, p.name ASC`
    : SORT_CONFIDENCE;

  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 200, 1), 2000);
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0);
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT
       l.nx_product_id, l.wc_product_id, l.pack_qty, l.status, l.match_method,
       l.score::float AS score, l.candidates, l.pack_source, l.pack_warning,
       l.reviewed_at, COALESCE(u.name, u.email) AS reviewed_by_name,
       p.name AS nx_name, p.code AS nx_code, p.barcode AS nx_barcode,
       p.cost::float AS nx_cost, p.price::float AS nx_price,
       c.name AS nx_category,
       st.stock::float AS nx_stock,
       pr.post_title AS wc_title, pr.sku AS wc_sku, pr.post_status AS wc_status,
       pr.image_url AS wc_image, pr.wp_product_id AS wc_wp_id,
       ${WC_COST}::float AS wc_cost,
       ${ALIGNED_COST}::float AS aligned_cost,
       ${ECART_PCT}::float    AS ecart_pct,
       ${ECART_VALEUR}::float AS ecart_valeur
     FROM nextore_product_links l
     JOIN nextore_products p ON p.product_id = l.nx_product_id
     LEFT JOIN nextore_categories c ON c.id = p.category_id
     LEFT JOIN products pr ON pr.id = l.wc_product_id
     LEFT JOIN users u ON u.id = l.reviewed_by
     ${shopJoin}
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY ${orderBy}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  // Hydratation des pistes alternatives (candidates) en un seul aller-retour
  const candIds = new Set();
  for (const r of rows) {
    for (const c of r.candidates || []) {
      if (c.wc_product_id && c.wc_product_id !== r.wc_product_id) candIds.add(c.wc_product_id);
    }
  }
  let candMap = new Map();
  if (candIds.size) {
    const { rows: cRows } = await pool.query(
      `SELECT pr.id, pr.post_title, pr.sku, pr.post_status,
              COALESCE(pr.computed_cost, pr.wc_cog_cost)::float AS cost
       FROM products pr WHERE pr.id = ANY($1::int[])`,
      [[...candIds]]
    );
    candMap = new Map(cRows.map((r) => [r.id, r]));
  }
  for (const r of rows) {
    r.candidates = (r.candidates || [])
      .filter((c) => c.wc_product_id !== r.wc_product_id && candMap.has(c.wc_product_id))
      .map((c) => ({ ...c, ...candMap.get(c.wc_product_id) }));
  }
  return rows;
}

/** Compteurs de la file + impact chiffré sur la valeur de stock, par boutique. */
async function getSummary(shopId) {
  const params = [];
  let stockJoin = 'LEFT JOIN LATERAL (SELECT SUM(ABS(stock)) AS stock FROM nextore_stock s WHERE s.product_id = p.product_id) st ON true';
  let stockFilter = '';
  if (shopId) {
    params.push(Number(shopId));
    stockJoin = `JOIN LATERAL (SELECT s.stock FROM nextore_stock s
                   WHERE s.product_id = p.product_id AND s.warehouse_id = $1) st ON true`;
    stockFilter = 'WHERE st.stock <> 0';
  }

  const { rows } = await pool.query(
    `SELECT
       COUNT(*)::int                                                            AS total,
       COUNT(*) FILTER (WHERE l.status = 'pending' AND l.wc_product_id IS NOT NULL)::int AS pending,
       COUNT(*) FILTER (WHERE l.status = 'pending' AND l.wc_product_id IS NULL)::int     AS unmatched,
       COUNT(*) FILTER (WHERE l.status = 'approved')::int                        AS approved,
       COUNT(*) FILTER (WHERE l.status = 'rejected')::int                        AS rejected,
       COUNT(*) FILTER (WHERE l.pack_warning IS NOT NULL AND l.status = 'pending')::int  AS warnings,
       COUNT(*) FILTER (WHERE l.status = 'approved' AND l.pack_qty > 1)::int      AS approved_packs,
       COALESCE(SUM(st.stock * COALESCE(p.cost, 0)) FILTER (WHERE l.status = 'approved'), 0)::float      AS approved_value_nextore,
       COALESCE(SUM(st.stock * ${ALIGNED_COST}) FILTER (WHERE l.status = 'approved'), 0)::float          AS approved_value_aligned,
       -- Enjeu restant : ce que la validation des propositions changerait
       COALESCE(SUM(${ECART_VALEUR}) FILTER (WHERE l.status = 'pending'), 0)::float                      AS pending_impact,
       COUNT(*) FILTER (WHERE l.status = 'pending' AND ABS(${ECART_PCT}) >= 0.3)::int                     AS pending_big_gap
     FROM nextore_product_links l
     JOIN nextore_products p ON p.product_id = l.nx_product_id
     LEFT JOIN products pr ON pr.id = l.wc_product_id
     ${stockJoin}
     ${stockFilter}`,
    params
  );
  const { rows: cfg } = await pool.query(
    "SELECT config_value FROM app_config WHERE config_key = 'nextore_last_match_at'"
  );
  return { ...rows[0], lastMatchAt: cfg[0]?.config_value || null };
}

/**
 * Produits site pour le rattachement manuel (recherche titre / SKU / EAN).
 *
 * Chaque mot doit être présent, mais pas forcément côte à côte : on tape
 * « nautilus mesh » pour trouver « Pack 5 Résistances Nautilus - 1.00 Ω mesh ».
 * Un ILIKE sur la chaîne entière ne ramènerait rien.
 */
async function searchWcProducts(q, limit = 25) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const words = term.split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];

  const params = [];
  const conds = words.map((w) => {
    params.push(`%${w}%`);
    return `(pr.post_title ILIKE $${params.length} OR pr.sku ILIKE $${params.length})`;
  });
  params.push(term);                       // EAN / SKU exact : court-circuite les mots
  const exactIdx = params.length;
  params.push(Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100));

  const { rows } = await pool.query(
    `SELECT DISTINCT ON (pr.id)
       pr.id, pr.post_title, pr.sku, pr.post_status, pr.product_type,
       pr.stock, COALESCE(pr.computed_cost, pr.wc_cog_cost)::float AS cost
     FROM products pr
     LEFT JOIN product_barcodes pb ON pb.product_id = pr.id
     WHERE pr.product_type IN ('simple', 'variation', 'woosb')
       AND ((${conds.join(' AND ')}) OR pb.barcode = $${exactIdx} OR pr.sku = $${exactIdx})
     ORDER BY pr.id, pr.post_status
     LIMIT $${params.length}`,
    params
  );
  // Publiés d'abord : un lien vers un brouillon est rarement le bon
  rows.sort((a, b) => (a.post_status === 'publish' ? 0 : 1) - (b.post_status === 'publish' ? 0 : 1));
  return rows;
}

/**
 * Applique une décision sur un lien. `wcProductId`/`packQty` non fournis =
 * inchangés. Passer en 'approved' sans produit site rattaché est refusé : il
 * n'y aurait rien à aligner.
 */
async function updateLink(nxProductId, patch, userId) {
  const { rows: cur } = await pool.query(
    'SELECT wc_product_id FROM nextore_product_links WHERE nx_product_id = $1',
    [String(nxProductId)]
  );
  if (!cur.length) throw new Error(`Lien introuvable : ${nxProductId}`);

  // Contrôle AVANT écriture : valider un lien sans produit site n'aligne rien
  const nextWcId = Object.prototype.hasOwnProperty.call(patch, 'wcProductId')
    ? patch.wcProductId
    : cur[0].wc_product_id;
  if (patch.status === 'approved' && !nextWcId) {
    throw new Error('Impossible de valider un lien sans produit site rattaché');
  }

  const sets = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'wcProductId')) {
    params.push(patch.wcProductId === null ? null : parseInt(patch.wcProductId, 10));
    sets.push(`wc_product_id = $${params.length}`);
    // Rattachement manuel : on trace l'origine et on neutralise le score moteur
    sets.push(`match_method = 'manual'`, 'score = NULL', 'candidates = NULL');
  }
  if (patch.packQty !== undefined) {
    const n = parseInt(patch.packQty, 10);
    if (!Number.isInteger(n) || n < 1) throw new Error('pack_qty doit être un entier >= 1');
    params.push(n);
    sets.push(`pack_qty = $${params.length}`, `pack_source = 'manual'`, 'pack_warning = NULL');
  }
  if (patch.status) {
    if (!['pending', 'approved', 'rejected'].includes(patch.status)) {
      throw new Error(`Statut invalide : ${patch.status}`);
    }
    params.push(patch.status);
    sets.push(`status = $${params.length}`);
    params.push(patch.status === 'pending' ? null : userId || null);
    sets.push(`reviewed_by = $${params.length}`);
    sets.push(patch.status === 'pending' ? 'reviewed_at = NULL' : 'reviewed_at = NOW()');
  }
  if (!sets.length) throw new Error('Aucune modification demandée');

  sets.push('updated_at = NOW()');
  params.push(String(nxProductId));

  const { rows } = await pool.query(
    `UPDATE nextore_product_links SET ${sets.join(', ')}
     WHERE nx_product_id = $${params.length}
     RETURNING nx_product_id, wc_product_id, pack_qty, status`,
    params
  );
  if (!rows.length) throw new Error(`Lien introuvable : ${nxProductId}`);
  return rows[0];
}

/**
 * Validation / rejet en masse. Les lignes sans produit site rattaché sont
 * ignorées à l'approbation (rien à aligner) et comptées à part.
 */
async function bulkUpdateStatus(nxProductIds, status, userId) {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    throw new Error(`Statut invalide : ${status}`);
  }
  const ids = (nxProductIds || []).map(String).filter(Boolean);
  if (!ids.length) return { updated: 0, skipped: 0 };

  const guard = status === 'approved' ? 'AND wc_product_id IS NOT NULL' : '';
  const { rows } = await pool.query(
    `UPDATE nextore_product_links
     SET status = $1,
         reviewed_by = $2,
         reviewed_at = ${status === 'pending' ? 'NULL' : 'NOW()'},
         updated_at = NOW()
     WHERE nx_product_id = ANY($3::text[]) ${guard}
     RETURNING nx_product_id`,
    [status, status === 'pending' ? null : userId || null, ids]
  );
  return { updated: rows.length, skipped: ids.length - rows.length };
}

module.exports = {
  WC_COST,
  ALIGNED_COST,
  listLinks,
  getSummary,
  searchWcProducts,
  updateLink,
  bulkUpdateStatus,
};
