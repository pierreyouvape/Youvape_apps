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

// « Sans catégorie » / « Sans sous-catégorie » : valeur de filtre réservée.
const NONE = '__none__';

const DIMENSIONS = {
  products:      { key: 's.product_id', label: 'COALESCE(MAX(p.name), MAX(s.product_name))' },
  brands:        { key: "COALESCE(NULLIF(TRIM(p.brand), ''), 'Sans marque')", label: null },
  // Clé = l'id Nextore (ou NONE) : un clic sur la ligne la reprend telle quelle comme filtre.
  categories:    { key: `COALESCE(c.id, '${NONE}')`, label: "COALESCE(MAX(c.name), 'Sans catégorie')" },
  subcategories: { key: `COALESCE(sc.id, '${NONE}')`, label: "COALESCE(MAX(sc.name), 'Sans sous-catégorie')" },
};

const CA_HT = 'SUM(s.quantity * s.unit_price / (1 + COALESCE(s.tax_rate, 20) / 100))::float';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {number} warehouseId 1 = Montpellier, 2 = Castelnau
 * @param {string} from AAAA-MM-JJ (inclus)
 * @param {string} to   AAAA-MM-JJ (inclus) — sold_at est en heure de Paris
 * @param {boolean} withAmounts true pour un responsable
 * @param {{ category?: string, subcategory?: string, search?: string }} filters
 *   category / subcategory : id Nextore ou NONE ; search : mots libres, TOUS
 *   présents dans le nom, la marque, la catégorie ou la sous-catégorie — ou
 *   égaux au code ou à l'un des codes-barres du produit. Code et EAN en
 *   valeur EXACTE : en « contient », « 10 » de « pulp 10 ml » prenait tous
 *   les codes et EAN où figure « 10 ».
 *
 * Les parts — du CA (`pct`) et des unités (`qtyPct`) — se calculent sur la
 * SÉLECTION filtrée ; `selectionPct` / `selectionQtyPct` donnent le poids de
 * cette sélection dans toute la boutique.
 */
async function getRankings(warehouseId, from, to, withAmounts, filters = {}) {
  if (!DATE_RE.test(from || '') || !DATE_RE.test(to || '')) {
    const err = new Error('Période invalide (from/to attendus en AAAA-MM-JJ)');
    err.statusCode = 400;
    throw err;
  }
  const category = filters.category || null;
  // Une sous-catégorie n'a de sens que sous sa catégorie.
  const subcategory = category ? (filters.subcategory || null) : null;
  const search = String(filters.search || '').trim().slice(0, 100);
  const words = search.split(/\s+/).filter(Boolean).slice(0, 8);

  const base = (useCategory, useSubcategory, useSearch = false) => {
    const params = [warehouseId, from, to];
    const where = ['s.warehouse_id = $1', 's.sold_at >= $2::date', 's.sold_at < $3::date + 1'];
    if (useCategory && category) {
      if (category === NONE) where.push('c.id IS NULL');
      else { params.push(category); where.push(`c.id = $${params.length}`); }
    }
    if (useSubcategory && subcategory) {
      if (subcategory === NONE) where.push('sc.id IS NULL');
      else { params.push(subcategory); where.push(`sc.id = $${params.length}`); }
    }
    if (useSearch) {
      for (const w of words) {
        params.push(`%${w.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, w);
        const like = params.length - 1;
        const exact = params.length;
        where.push(`(concat_ws(' ', p.name, s.product_name, p.brand, c.name, sc.name) ILIKE $${like}
          OR lower(p.code) = lower($${exact})
          OR EXISTS (SELECT 1 FROM nextore_product_barcodes b WHERE b.product_id = s.product_id AND b.barcode = $${exact}))`);
      }
    }
    return {
      params,
      sql: `FROM nextore_sales s
       LEFT JOIN nextore_products p ON p.product_id = s.product_id
       LEFT JOIN nextore_categories c ON c.id = p.category_id
       LEFT JOIN nextore_subcategories sc ON sc.id = p.subcategory_id
       WHERE ${where.join(' AND ')}`,
    };
  };

  const rank = async ({ key, label }) => {
    const { sql, params } = base(true, true, true);
    const { rows } = await pool.query(
      `SELECT ${key} AS id, ${label || key} AS name,
              SUM(s.quantity)::float AS qty, ${CA_HT} AS ca_ht
       ${sql}
       GROUP BY ${key}`,
      params
    );
    return rows;
  };

  // Options des listes : catégories vendues sur la période (sans filtre),
  // sous-catégories vendues dans la catégorie choisie.
  const options = async (idExpr, nameExpr, useCategory) => {
    const { sql, params } = base(useCategory, false);
    const { rows } = await pool.query(
      `SELECT ${idExpr} AS id, ${nameExpr} AS name
       ${sql}
       GROUP BY 1, 2
       ORDER BY (${idExpr} = '${NONE}'), 2`,
      params
    );
    return rows;
  };

  const shopTotal = async () => {
    const { sql, params } = base(false, false);
    const { rows } = await pool.query(`SELECT ${CA_HT} AS ca_ht, SUM(s.quantity)::float AS qty ${sql}`, params);
    return { ca_ht: rows[0].ca_ht || 0, qty: rows[0].qty || 0 };
  };

  const [products, brands, categories, categoryOptions, subcategoryOptions, boutique, sync] = await Promise.all([
    rank(DIMENSIONS.products),
    rank(DIMENSIONS.brands),
    // Une catégorie choisie : l'onglet détaille ses sous-catégories.
    rank(category ? DIMENSIONS.subcategories : DIMENSIONS.categories),
    options(`COALESCE(c.id, '${NONE}')`, "COALESCE(c.name, 'Sans catégorie')", false),
    category
      ? options(`COALESCE(sc.id, '${NONE}')`, "COALESCE(sc.name, 'Sans sous-catégorie')", true)
      : Promise.resolve([]),
    shopTotal(),
    // timestamptz → date ISO dans le JSON (le texte brut de app_config ne se lit pas partout)
    pool.query("SELECT config_value::timestamptz AS at FROM app_config WHERE config_key = 'nextore_last_sales_sync_at'"),
  ]);

  const total = products.reduce((sum, r) => sum + r.ca_ht, 0);
  const totalQty = products.reduce((sum, r) => sum + r.qty, 0);
  const part = (value, of, decimals) => (of ? Math.round((value / of) * 10 ** (decimals + 2)) / 10 ** decimals : 0);
  const shape = (rows) => [...rows]
    .sort((a, b) => b.ca_ht - a.ca_ht)
    .map((r) => ({
      id: String(r.id),
      name: r.name,
      qty: r.qty,
      pct: part(r.ca_ht, total, 2),
      qtyPct: part(r.qty, totalQty, 2),
      ...(withAmounts ? { ca_ht: Math.round(r.ca_ht * 100) / 100 } : {}),
    }));

  return {
    from,
    to,
    lastSalesSyncAt: sync.rows[0]?.at || null,
    filters: { category, subcategory, search },
    options: { categories: categoryOptions, subcategories: subcategoryOptions },
    totals: {
      qty: totalQty,
      selectionPct: part(total, boutique.ca_ht, 1),
      selectionQtyPct: part(totalQty, boutique.qty, 1),
      ...(withAmounts ? { ca_ht: Math.round(total * 100) / 100 } : {}),
    },
    products: shape(products),
    brands: shape(brands),
    categories: shape(categories),
    categoriesAreSubcategories: Boolean(category),
  };
}

module.exports = { getRankings, NONE };
