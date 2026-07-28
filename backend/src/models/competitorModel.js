/**
 * Accès BDD pour la veille concurrentielle (mapping + historique des prix).
 */
const pool = require('../config/database');

const competitorModel = {
  // ─── Mapping produits ↔ concurrents ─────────────────────────────
  listProducts: async ({ activeOnly = false } = {}) => {
    const where = activeOnly ? 'WHERE active = TRUE' : '';
    const { rows } = await pool.query(
      `SELECT id, sku, product_name, competitor, url, active, created_at, updated_at
       FROM competitor_products ${where}
       ORDER BY sku, competitor`
    );
    return rows;
  },

  // Suivis actifs qui n ont encore AUCUN tarif relevé (nouveaux produits)
  listProductsNeedingPrice: async () => {
    const { rows } = await pool.query(
      `SELECT p.id, p.sku, p.product_name, p.competitor, p.url, p.active
       FROM competitor_products p
       WHERE p.active = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM competitor_prices cp
           WHERE cp.competitor_product_id = p.id AND cp.status = 'ok' AND cp.price IS NOT NULL
         )
       ORDER BY p.sku, p.competitor`
    );
    return rows;
  },

  getProduct: async (id) => {
    const { rows } = await pool.query('SELECT * FROM competitor_products WHERE id = $1', [id]);
    return rows[0] || null;
  },

  createProduct: async ({ sku, product_name, competitor, url, active = true }) => {
    const { rows } = await pool.query(
      `INSERT INTO competitor_products (sku, product_name, competitor, url, active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (competitor, url) DO UPDATE
         SET sku = EXCLUDED.sku, product_name = EXCLUDED.product_name,
             active = EXCLUDED.active, updated_at = NOW()
       RETURNING *`,
      [sku, product_name || null, competitor, url, active]
    );
    return rows[0];
  },

  updateProduct: async (id, fields) => {
    const allowed = ['sku', 'product_name', 'competitor', 'url', 'active'];
    const sets = [];
    const vals = [];
    let i = 1;
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(fields[key]);
      }
    }
    if (!sets.length) return competitorModel.getProduct(id);
    sets.push('updated_at = NOW()');
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE competitor_products SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
      vals
    );
    return rows[0] || null;
  },

  deleteProduct: async (id) => {
    await pool.query('DELETE FROM competitor_products WHERE id = $1', [id]);
  },


  // ─── Suggestions de matching (découverte) ───────────────────────
  listSuggestions: async (status) => {
    const where = status ? "WHERE status = $1" : "";
    const params = status ? [status] : [];
    const { rows } = await pool.query(
      `SELECT * FROM competitor_match_suggestions ${where} ORDER BY competitor, match_score DESC NULLS LAST, model_label`,
      params
    );
    return rows;
  },

  getSuggestion: async (id) => {
    const { rows } = await pool.query("SELECT * FROM competitor_match_suggestions WHERE id = $1", [id]);
    return rows[0] || null;
  },

  updateSuggestion: async (id, fields) => {
    const allowed = ["matched_sku", "matched_title", "model_label", "representative_url", "status"];
    const sets = [], vals = [];
    let i = 1;
    for (const k of allowed) if (fields[k] !== undefined) { sets.push(`${k} = $${i++}`); vals.push(fields[k]); }
    if (!sets.length) return competitorModel.getSuggestion(id);
    sets.push("updated_at = NOW()");
    vals.push(id);
    const { rows } = await pool.query(
      `UPDATE competitor_match_suggestions SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals
    );
    return rows[0] || null;
  },

  deleteSuggestion: async (id) => {
    await pool.query("DELETE FROM competitor_match_suggestions WHERE id = $1", [id]);
  },

  // ─── Historique des prix ────────────────────────────────────────
  getLastOkPrice: async (competitorProductId) => {
    const { rows } = await pool.query(
      `SELECT * FROM competitor_prices
       WHERE competitor_product_id = $1 AND status = 'ok' AND price IS NOT NULL
       ORDER BY checked_at DESC LIMIT 1`,
      [competitorProductId]
    );
    return rows[0] || null;
  },

  insertPrice: async (p) => {
    const { rows } = await pool.query(
      `INSERT INTO competitor_prices
         (competitor_product_id, price, regular_price, in_stock, currency, status, error_message, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        p.competitor_product_id,
        p.price ?? null,
        p.regular_price ?? null,
        p.in_stock ?? null,
        p.currency || 'EUR',
        p.status || 'ok',
        p.error_message || null,
        p.source || null,
      ]
    );
    return rows[0];
  },

  getHistory: async (competitorProductId, limit = 90) => {
    const { rows } = await pool.query(
      `SELECT price, regular_price, in_stock, status, checked_at
       FROM competitor_prices
       WHERE competitor_product_id = $1
       ORDER BY checked_at DESC LIMIT $2`,
      [competitorProductId, limit]
    );
    return rows;
  },

  /**
   * Tableau de bord : pour chaque suivi, le dernier relevé OK + le précédent,
   * pour afficher prix courant, variation et disponibilité.
   */
  getDashboard: async () => {
    const { rows } = await pool.query(
      `WITH ranked AS (
         SELECT cp.*,
                ROW_NUMBER() OVER (PARTITION BY competitor_product_id
                                   ORDER BY checked_at DESC) AS rn
         FROM competitor_prices cp
         WHERE status = 'ok' AND price IS NOT NULL
       ),
       last_any AS (
         SELECT DISTINCT ON (competitor_product_id)
                competitor_product_id, status, error_message, checked_at, source
         FROM competitor_prices
         ORDER BY competitor_product_id, checked_at DESC
       )
       SELECT
         p.id, p.sku, p.product_name, p.competitor, p.url, p.active,
         COALESCE(yp.discounted_price, yp.price) AS my_price,
         yp.regular_price AS my_regular_price,
         CASE WHEN yprod.wp_product_id IS NOT NULL
              THEN 'https://www.youvape.fr/?post_type=product&p=' || yprod.wp_product_id END AS my_product_url,
         cur.price        AS current_price,
         cur.regular_price,
         cur.in_stock,
         cur.checked_at   AS current_checked_at,
         prev.price       AS previous_price,
         prev.checked_at  AS previous_checked_at,
         la.status        AS last_status,
         la.error_message AS last_error,
         la.checked_at    AS last_checked_at
       FROM competitor_products p
       LEFT JOIN ranked cur  ON cur.competitor_product_id = p.id  AND cur.rn = 1
       LEFT JOIN ranked prev ON prev.competitor_product_id = p.id AND prev.rn = 2
       LEFT JOIN last_any la ON la.competitor_product_id = p.id
       LEFT JOIN products yp ON yp.sku = p.sku
       LEFT JOIN products yprod ON yprod.sku = split_part(p.sku, '-', 1)
       ORDER BY p.sku, p.competitor`
    );
    return rows;
  },
};

module.exports = competitorModel;
