/**
 * Catalogue caisse — liste à vérifier (boutique_catalog_reviews), alimentée par
 * nextoreCatalogSyncService. Rattacher / créer passent par prelevementModel
 * (link, createInNextore), qui referment les lignes du produit.
 */

const pool = require('../config/database');
const sync = require('../services/nextoreCatalogSyncService');

const httpError = (status, message) => Object.assign(new Error(message), { statusCode: status });

const REASONS = ['doublon', 'categorie', 'sans_ean', 'ean_multiple', 'ean_conflit', 'prix', 'absent'];

const list = async ({ reason, q, offset = 0, limit = 100 }) => {
  if (!REASONS.includes(reason)) throw httpError(400, 'Motif inconnu.');
  const args = [reason];
  let filter = '';
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
            np.name AS nx_name, np.price AS nx_price
       FROM boutique_catalog_reviews r
       JOIN products p ON p.id = r.product_id
       LEFT JOIN products pp ON p.product_type = 'variation' AND pp.wp_product_id = p.wp_parent_id
       LEFT JOIN nextore_categories c ON c.id = r.suggested_category_id
       LEFT JOIN nextore_products np ON np.product_id = r.nx_product_id
      WHERE r.status = 'open' AND r.reason = $1 ${filter}
      ORDER BY ${reason === 'prix' ? "abs((r.detail->>'ecart_pct')::numeric) DESC" : reason === 'absent' ? 'p.stock DESC NULLS LAST' : 'r.created_at DESC'}
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
      await sync.pushPrice(r.product_id, r.nx_product_id, r.regular_price);
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

module.exports = { list, ignore, alignPrices, keepPrices, REASONS };
