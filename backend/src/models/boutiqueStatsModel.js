/**
 * Stats boutiques — classements produits / marques / catégories des ventes
 * caisse Nextore (nextore_sales), par boutique et par période.
 *
 * CA HT d'une ligne = quantity × unit_price ÷ (1 + tax_rate / 100) :
 * `unit_price` est le prix TTC NET de remise (un article offert vaut 0, la
 * remise est dans `item_discount`). Les retours (quantités négatives) sont
 * déduits : tout est net.
 *
 * Deux niveaux de lecture (droit `stats-boutiques`) : le conseiller reçoit la
 * quantité et la part du CA, jamais un montant ; le responsable reçoit aussi
 * le CA HT. Les montants sont retirés ICI, pas à l'écran — sinon ils restent
 * lisibles dans les outils du navigateur.
 */

const pool = require('../config/database');

const DIMENSIONS = {
  products:   { key: 's.product_id', label: 'COALESCE(MAX(p.name), MAX(s.product_name))' },
  brands:     { key: "COALESCE(NULLIF(TRIM(p.brand), ''), 'Sans marque')", label: null },
  categories: { key: "COALESCE(c.name, 'Sans catégorie')", label: null },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {number} warehouseId 1 = Montpellier, 2 = Castelnau
 * @param {string} from AAAA-MM-JJ (inclus)
 * @param {string} to   AAAA-MM-JJ (inclus) — sold_at est en heure de Paris
 * @param {boolean} withAmounts true pour un responsable
 */
async function getRankings(warehouseId, from, to, withAmounts) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    const err = new Error('Période invalide (from/to attendus en AAAA-MM-JJ)');
    err.statusCode = 400;
    throw err;
  }

  const rank = async ({ key, label }) => {
    const { rows } = await pool.query(
      `SELECT ${key} AS id,
              ${label || key} AS name,
              SUM(s.quantity)::float AS qty,
              SUM(s.quantity * s.unit_price / (1 + COALESCE(s.tax_rate, 20) / 100))::float AS ca_ht
       FROM nextore_sales s
       LEFT JOIN nextore_products p ON p.product_id = s.product_id
       LEFT JOIN nextore_categories c ON c.id = p.category_id
       WHERE s.warehouse_id = $1
         AND s.sold_at >= $2::date
         AND s.sold_at < $3::date + 1
       GROUP BY ${key}`,
      [warehouseId, from, to]
    );
    return rows;
  };

  const [products, brands, categories, sync] = await Promise.all([
    rank(DIMENSIONS.products),
    rank(DIMENSIONS.brands),
    rank(DIMENSIONS.categories),
    // timestamptz → date ISO dans le JSON (le texte brut de app_config ne se lit pas partout)
    pool.query("SELECT config_value::timestamptz AS at FROM app_config WHERE config_key = 'nextore_last_sales_sync_at'"),
  ]);

  const total = products.reduce((sum, r) => sum + r.ca_ht, 0);
  const shape = (rows) => [...rows]
    .sort((a, b) => b.ca_ht - a.ca_ht)
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      qty: r.qty,
      pct: total ? Math.round((r.ca_ht / total) * 10000) / 100 : 0,
      ...(withAmounts ? { ca_ht: Math.round(r.ca_ht * 100) / 100 } : {}),
    }));

  return {
    from,
    to,
    lastSalesSyncAt: sync.rows[0]?.at || null,
    totals: {
      qty: products.reduce((sum, r) => sum + r.qty, 0),
      ...(withAmounts ? { ca_ht: Math.round(total * 100) / 100 } : {}),
    },
    products: shape(products),
    brands: shape(brands),
    categories: shape(categories),
  };
}

module.exports = { getRankings };
