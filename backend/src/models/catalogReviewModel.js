/**
 * Catalogue caisse — liste à vérifier (boutique_catalog_reviews), alimentée par
 * nextoreCatalogSyncService. Rattacher / créer passent par prelevementModel
 * (link, createInNextore), qui referment les lignes du produit.
 */

const pool = require('../config/database');
const sync = require('../services/nextoreCatalogSyncService');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const REASONS = ['doublon', 'categorie', 'sans_ean', 'ean_multiple', 'ean_conflit', 'prix', 'absent'];

const list = async ({ reason, q, offset = 0, limit = 100, same = false, near = false }) => {
  if (!REASONS.includes(reason)) throw httpError(400, 'Motif inconnu.');
  const args = [reason];
  let filter = same ? ` AND r.candidates @> '[{"same": true}]'::jsonb` : '';
  // « Avec une fiche proche » : à trancher par un humain, meilleure ressemblance d'abord.
  if (near) filter += ` AND jsonb_array_length(COALESCE(r.candidates, '[]'::jsonb)) > 0`;
  const words = String(q || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  for (const w of words) {
    args.push(`%${w}%`);
    filter += ` AND concat_ws(' ', p.post_title, p.sku, p.brand, pp.brand) ILIKE $${args.length}`;
  }
  args.push(Math.min(Number(limit) || 100, 200), Math.max(Number(offset) || 0, 0));
  const { rows } = await pool.query(
    `SELECT r.id, r.reason, r.product_id, r.nx_product_id, r.candidates, r.detail, r.created_at,
            r.suggested_category_id, c.name AS suggested_category,
            p.sku, p.post_title AS name, p.regular_price, COALESCE(p.stock, 0) AS stock,
            COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand,
            COALESCE(p.image_url, pp.image_url) AS image_url,
            np.name AS nx_name, np.price AS nx_price,
            (SELECT st.stock::float FROM nextore_stock st WHERE st.product_id = r.nx_product_id AND st.warehouse_id = 2) AS cast_stock,
            (SELECT st.stock::float FROM nextore_stock st WHERE st.product_id = r.nx_product_id AND st.warehouse_id = 1) AS mtp_stock
       FROM boutique_catalog_reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN nextore_categories c ON c.id = r.suggested_category_id
       LEFT JOIN nextore_products np ON np.product_id = r.nx_product_id
      WHERE r.status = 'open' AND r.reason = $1 ${filter}
      ORDER BY ${reason === 'prix' ? "abs((r.detail->>'ecart_pct')::numeric) DESC"
        : near ? "(r.candidates->0->>'score')::numeric DESC NULLS LAST"
        : reason === 'absent' ? 'p.stock DESC NULLS LAST' : 'r.created_at DESC'}
      LIMIT $${args.length - 1} OFFSET $${args.length}`,
    args
  );
  const { rows: counts } = await pool.query(
    `SELECT reason, count(*)::int AS n FROM boutique_catalog_reviews WHERE status = 'open' GROUP BY 1`
  );
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.reason, c.n])) };
};

const close = (ids, resolution, userId, status = 'done') => pool.query(
  `UPDATE boutique_catalog_reviews SET status = $2, resolution = $3, resolved_by = $4, resolved_at = NOW()
    WHERE id = ANY($1::bigint[]) AND status = 'open'`,
  [ids, status, resolution, userId || null]
);

const ignore = async (id, userId) => {
  await close([id], 'ignored', userId, 'ignored');
  return { ok: true };
};

const loadPriceReviews = async (ids) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.product_id, r.nx_product_id, p.regular_price, p.sku
       FROM boutique_catalog_reviews r JOIN products p ON p.id = r.product_id
      WHERE r.id = ANY($1::bigint[]) AND r.reason = 'prix' AND r.status = 'open'`,
    [ids]
  );
  return rows;
};

/** Aligne le prix caisse sur le prix normal du site (lu au moment du clic). */
const alignPrices = async (ids, userId) => {
  const rows = await loadPriceReviews(ids);
  const errors = [];
  let done = 0;
  for (const r of rows) {
    try {
      await sync.pushPrice(r.product_id, r.nx_product_id, r.regular_price, 'aligned');
      await close([r.id], 'aligned', userId);
      done += 1;
    } catch (error) {
      errors.push(`${r.sku} : ${error.message}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return { done, errors };
};

/** Garde le prix caisse : plus jamais aligné pour ce produit. */
const keepPrices = async (ids, userId) => {
  const rows = await loadPriceReviews(ids);
  for (const r of rows) {
    await sync.savePrice(r.product_id, r.nx_product_id, r.regular_price, true);
    await close([r.id], 'kept', userId);
  }
  return { done: rows.length };
};

/**
 * Rattache d'un coup les lignes dont UNE fiche caisse porte exactement le même
 * nom (candidat `same`, mêmes mots hors marque). Validé à l'écran sur la liste.
 */
const linkSame = async (ids, userId) => {
  const prelevementModel = require('./prelevementModel');
  const { isSameName } = require('../services/catalogSyncRules');
  const { rows } = await pool.query(
    `SELECT r.id, r.product_id, r.candidates, p.sku, p.post_title AS name,
            COALESCE(NULLIF(p.brand, ''), pp.brand) AS brand, COALESCE(NULLIF(p.sub_brand, ''), pp.sub_brand) AS sub_brand
       FROM boutique_catalog_reviews r JOIN products p ON p.id = r.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
      WHERE r.id = ANY($1::bigint[]) AND r.status = 'open' AND r.reason IN ('doublon', 'absent')`,
    [ids]
  );
  let done = 0;
  const errors = [];
  for (const r of rows) {
    const same = (r.candidates || []).filter((c) => c.same);
    if (same.length !== 1) continue;
    // Revérifié à l'instant avec les fiches caisse à jour, jamais sur la seule suggestion enregistrée.
    const { rows: [nx] } = await pool.query(
      `SELECT name, brand FROM nextore_products WHERE product_id = $1 AND COALESCE(status, '') <> 'deleted'`, [same[0].id]
    );
    if (!nx || !isSameName(r, nx)) { errors.push(`${r.sku} : nom plus identique, non rattaché`); continue; }
    try {
      await prelevementModel.link(2, r.product_id, same[0].id, userId);
      done += 1;
    } catch (error) {
      errors.push(`${r.sku} : ${error.message}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return { done, errors };
};

// ── Étiquettes de prix à refaire (boutique_price_labels) ────────────────────

const SHOP_COL = { 1: 'mtp', 2: 'cast' };

/** Prix changés dans la caisse : `todo` = pas encore refaits dans CETTE boutique. */
const labels = async (warehouseId, { todo = true } = {}) => {
  const col = SHOP_COL[warehouseId];
  if (!col) throw httpError(400, 'Boutique inconnue.');
  const { rows } = await pool.query(
    `SELECT l.id, l.old_price, l.new_price, l.changed_at, l.source, l.done_mtp_at, l.done_cast_at,
            np.name AS nx_name, np.barcode, c.name AS category, p.sku, p.post_title AS name,
            st.stock::float AS shop_stock
       FROM boutique_price_labels l
       LEFT JOIN nextore_products np ON np.product_id = l.nx_product_id
       LEFT JOIN nextore_categories c ON c.id = np.category_id
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN nextore_stock st ON st.product_id = l.nx_product_id AND st.warehouse_id = $1
      WHERE ${todo ? `l.done_${col}_at IS NULL` : 'true'}
      ORDER BY c.name NULLS LAST, np.name
      LIMIT 2000`,
    [warehouseId]
  );
  const { rows: [counts] } = await pool.query(
    `SELECT count(*) FILTER (WHERE done_mtp_at IS NULL)::int AS mtp, count(*) FILTER (WHERE done_cast_at IS NULL)::int AS cast
       FROM boutique_price_labels`
  );
  return { rows, counts };
};

const labelsDone = async (warehouseId, ids, userId, done = true) => {
  const col = SHOP_COL[warehouseId];
  if (!col) throw httpError(400, 'Boutique inconnue.');
  const { rowCount } = await pool.query(
    `UPDATE boutique_price_labels SET done_${col}_at = ${done ? 'NOW()' : 'NULL'}, done_${col}_by = $2 WHERE id = ANY($1::bigint[])`,
    [ids, done ? userId : null]
  );
  return { done: rowCount };
};

// ── Existants sans catégorie caisse : un choix par groupe (sous-catégorie du site) ──

const GROUP_SQL = `COALESCE(NULLIF(p.category, ''), pp.category, '')`;
const SUBGROUP_SQL = `COALESCE(NULLIF(p.sub_category, ''), pp.sub_category, '')`;

const uncategorizedGroups = async () => {
  const { rows } = await pool.query(
    `SELECT ${GROUP_SQL} AS cat, ${SUBGROUP_SQL} AS sub, count(*)::int AS n,
            (array_agg(p.post_title ORDER BY p.stock DESC NULLS LAST))[1:3] AS examples
       FROM boutique_catalog_reviews r JOIN products p ON p.id = r.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
      WHERE r.status = 'open' AND r.reason = 'absent' AND r.suggested_category_id IS NULL
      GROUP BY 1, 2 ORDER BY 3 DESC`
  );
  return rows;
};

/** Pose la catégorie caisse de tout un groupe (pour « Créer tous » ensuite). */
const setGroupCategory = async ({ cat, sub, categoryId }) => {
  if (!categoryId) throw httpError(400, 'Choisissez une catégorie caisse.');
  const { rowCount } = await pool.query(
    `UPDATE boutique_catalog_reviews r SET suggested_category_id = $3
       FROM products p LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
      WHERE p.id = r.product_id AND r.status = 'open' AND r.reason = 'absent' AND r.suggested_category_id IS NULL
        AND ${GROUP_SQL} = $1 AND ${SUBGROUP_SQL} = $2`,
    [cat || '', sub || '', String(categoryId)]
  );
  return { updated: rowCount };
};

// ── Création en masse des existants absents ─────────────────────────────────

const bulk = { running: false, total: 0, created: 0, errors: [], startedAt: null, finishedAt: null, by: null };

/**
 * Crée dans la caisse tous les « existants absents » encore ouverts qui ont une
 * catégorie proposée (décision Maxime, 10/11/2026 : ce qu'il n'a pas rattaché est
 * à créer). Tâche de fond, une fiche à la fois ; sans catégorie : restent en liste.
 */
const createAllAbsent = async (userId) => {
  if (bulk.running) return bulkStatus();
  const prelevementModel = require('./prelevementModel');
  const { isResistance } = require('../services/catalogSyncRules');
  const { rows: all } = await pool.query(
    `SELECT r.id, r.product_id, r.suggested_category_id, p.sku, p.post_title AS name, c.name AS category
       FROM boutique_catalog_reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN nextore_categories c ON c.id = r.suggested_category_id
      WHERE r.status = 'open' AND r.reason = 'absent' AND r.suggested_category_id IS NOT NULL
      ORDER BY p.stock DESC NULLS LAST`
  );
  // Résistances (pack sur le site, unité en boutique) : laissées de côté (Maxime, 10/11/2026).
  const rows = all.filter((r) => !isResistance(r.name, r.category));
  Object.assign(bulk, { running: true, total: rows.length, created: 0, errors: [], startedAt: new Date(), finishedAt: null, by: userId });
  (async () => {
    for (const r of rows) {
      try {
        await prelevementModel.createInNextore(2, r.product_id, r.suggested_category_id, userId, { quiet: true });
        bulk.created += 1;
      } catch (error) {
        bulk.errors.push(`${r.sku} : ${error.message}`);
        if (/HTTP 429|Too Many/i.test(error.message)) await new Promise((res) => setTimeout(res, 60000));
      }
      await new Promise((res) => setTimeout(res, 300));
    }
  })().catch((error) => bulk.errors.push(`Arrêt : ${error.message}`))
    .finally(() => { bulk.running = false; bulk.finishedAt = new Date(); });
  return bulkStatus();
};

const bulkStatus = () => ({ ...bulk, errors: bulk.errors.slice(-20), errorCount: bulk.errors.length });

module.exports = {
  list, ignore, alignPrices, keepPrices, linkSame, REASONS, labels, labelsDone, createAllAbsent, bulkStatus,
  uncategorizedGroups, setGroupCategory,
};
