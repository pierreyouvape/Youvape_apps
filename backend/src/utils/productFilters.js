const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

// Filtres produits partagés par l'onglet Produits (liste, vue par mois) et par
// l'onglet Catégories : mêmes champs, mêmes opérateurs, même traitement des
// attributs de déclinaison. Un seul endroit à faire évoluer.

const STATS_FILTER_FIELDS = {
  stock: 'number', qty_sold: 'number', velocity: 'number', coverage_days: 'number',
  margin_percent: 'number', ca_ttc: 'number', ca_ht: 'number', cost_ht: 'number',
  unit_cost: 'number', stock_value: 'number', price: 'number', weight: 'number',
  last_sold: 'date', first_sold: 'date', created_date: 'date',
  brand: 'text', sub_brand: 'text', category: 'text', sub_category: 'text',
  post_title: 'text',
  supplier: 'text', stock_status: 'text', product_type: 'enum',
};
// Un produit peut porter plusieurs marques dans WordPress alors que
// products.brand n'en garde qu'une : wp_product_brands (brandMapService) complete.
/**
 * Construit une clause SQL (booléenne, sans le WHERE) à partir d'un tableau de filtres
 * { field, op, value, value2 } et d'un type de correspondance ('all' => AND, 'any' => OR).
 * Les champs et opérateurs sont whitelistés ; les valeurs sont paramétrées via P().
 * Retourne '' si aucun filtre valide.
 */
function buildStatsFilterClause(filters, matchType, P, opts = {}) {
  if (!Array.isArray(filters) || filters.length === 0) return '';
  // `alias` : préfixe de table quand la clause ne s'applique pas à la CTE `final`
  // (onglet Catégories : les colonnes viennent directement de `products p`).
  // `allow` : sous-ensemble de champs utilisable — les autres sont ignorés en
  // silence, comme un champ inconnu.
  const { alias = '', allow = null } = opts;
  const conds = [];
  for (const f of filters) {
    const type = STATS_FILTER_FIELDS[f && f.field];
    if (!type) continue;
    if (allow && !allow.includes(f.field)) continue;
    const col = alias ? `${alias}.${f.field}` : f.field; // whitelisté => sûr
    const op = f.op;

    if (type === 'number') {
      const v = Number(f.value);
      if (f.value === '' || f.value == null || Number.isNaN(v)) continue;
      const map = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', neq: '<>' };
      if (map[op]) conds.push(`${col} ${map[op]} ${P(v)}`);
      else if (op === 'between') {
        const v2 = Number(f.value2);
        if (Number.isNaN(v2)) continue;
        conds.push(`${col} BETWEEN ${P(v)} AND ${P(v2)}`);
      }
    } else if (type === 'date') {
      if (op === 'over_days_ago') { const n = Number(f.value); if (Number.isNaN(n)) continue; conds.push(`(${col} IS NULL OR ${col} < CURRENT_DATE - ${P(n)}::int)`); }
      else if (op === 'within_days') { const n = Number(f.value); if (Number.isNaN(n)) continue; conds.push(`${col} >= CURRENT_DATE - ${P(n)}::int`); }
      else if (op === 'before') { if (!isYmd(f.value)) continue; conds.push(`${col} < ${P(f.value)}`); }
      else if (op === 'after') { if (!isYmd(f.value)) continue; conds.push(`${col} > ${P(f.value)}`); }
      else if (op === 'between') { if (!isYmd(f.value) || !isYmd(f.value2)) continue; conds.push(`(${col} >= ${P(f.value)} AND ${col} < (${P(f.value2)}::date + 1))`); }
      else if (op === 'is_set') conds.push(`${col} IS NOT NULL`);
      else if (op === 'not_set') conds.push(`${col} IS NULL`);
    } else if (type === 'text') {
      if (f.value == null || f.value === '') continue;
      if (op === 'contains') conds.push(`${col} ILIKE ${P('%' + f.value + '%')}`);
      else if (op === 'eq') conds.push(`${col} = ${P(f.value)}`);
      else if (op === 'neq') conds.push(`${col} IS DISTINCT FROM ${P(f.value)}`);
    } else if (type === 'enum') {
      if (f.value == null || f.value === '') continue;
      if (op === 'neq') conds.push(`${col} <> ${P(f.value)}`);
      else conds.push(`${col} = ${P(f.value)}`);
    }
  }
  if (conds.length === 0) return '';
  return '(' + conds.join(matchType === 'any' ? ' OR ' : ' AND ') + ')';
}

/**
 * CTE communes aux deux lectures de l'onglet Produits : la liste (getAllForStats)
 * et la vue par mois (getMonthlyForStats). Même périmètre, même définition du CA
 * (composants de packs woosb à 0 €), mêmes filtres — les deux vues ne peuvent pas
 * diverger. Les fragments passés sont construits côté serveur, jamais saisis.
 */
function statsCtes({ periodWhere, lifeWhere, searchClause, stockExpr, periodDays }) {
  return `
      WITH prod_parent AS (
        -- Résout chaque produit vers son parent (la variation pointe vers son parent)
        SELECT wp_product_id AS pid,
               CASE WHEN product_type = 'variation' THEN wp_parent_id ELSE wp_product_id END AS parent_id
        FROM products
      ),
      var_stock AS (
        -- value : même formule que la valeur de stock du catalogue (countForCatalog),
        -- déclinaisons publiées, stock négatif ramené à 0.
        SELECT wp_parent_id, SUM(stock::int) AS s,
          SUM(GREATEST(COALESCE(stock, 0), 0) * COALESCE(computed_cost, wc_cog_cost, 0))
            FILTER (WHERE post_status = 'publish') AS value,
          SUM(GREATEST(COALESCE(stock, 0), 0)) FILTER (WHERE post_status = 'publish') AS pos_stock,
          AVG(NULLIF(COALESCE(computed_cost, wc_cog_cost, 0), 0))
            FILTER (WHERE post_status = 'publish') AS avg_cost
        FROM products WHERE product_type = 'variation' GROUP BY wp_parent_id
      ),
      bundle_sub_items AS (
        -- Sous-produits de bundles woosb vendus à 0€ (à exclure du CA, garder la qté)
        SELECT DISTINCT oi.id AS order_item_id
        FROM order_items oi
        INNER JOIN order_items oi_bundle ON oi.wp_order_id = oi_bundle.wp_order_id
        INNER JOIN products p_bundle ON p_bundle.wp_product_id = oi_bundle.product_id
        WHERE p_bundle.product_type = 'woosb' AND p_bundle.woosb_ids IS NOT NULL AND oi.line_total = 0
          AND oi.product_id::text = ANY(
            SELECT jsonb_array_elements_text(jsonb_path_query_array(p_bundle.woosb_ids, '$[*].id')))
      ),
      item_base AS (
        -- Chaque ligne de commande rattachée à son produit PARENT (via variation_id sinon product_id).
        -- Le coût reste joint sur product_id pour conserver les marges historiques.
        SELECT oi.id AS order_item_id, pp.parent_id,
               COALESCE(NULLIF(oi.variation_id, 0), oi.product_id) AS sold_pid, oi.qty,
               oi.line_total, oi.line_tax,
               oi.qty * COALESCE(pcost.computed_cost, pcost.wc_cog_cost, 0) AS cost_line,
               o.post_date,
               COALESCE(NULLIF(o.shipping_country, ''), o.billing_country) AS country,
               (oi.id IN (SELECT order_item_id FROM bundle_sub_items)) AS is_bundle_sub
        FROM order_items oi
        JOIN prod_parent pp ON pp.pid = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
        JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status IN ('wc-completed', 'wc-delivered', 'wc-processing', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered')
        LEFT JOIN products pcost ON pcost.wp_product_id = oi.product_id
      ),
      period_stats AS (
        SELECT ib.parent_id,
          SUM(ib.qty)::int AS qty_sold,
          SUM(CASE WHEN ib.is_bundle_sub THEN 0 ELSE COALESCE(ib.line_total, 0) + COALESCE(ib.line_tax, 0) END) AS ca_ttc,
          SUM(CASE WHEN ib.is_bundle_sub THEN 0 ELSE COALESCE(ib.line_total, 0) END) AS ca_ht,
          SUM(CASE WHEN ib.is_bundle_sub THEN 0 ELSE ib.cost_line END) AS cost_ht
        FROM item_base ib
        ${periodWhere}
        GROUP BY ib.parent_id
      ),
      lifetime_stats AS (
        SELECT ib.parent_id, MIN(ib.post_date) AS first_sold, MAX(ib.post_date) AS last_sold
        FROM item_base ib
        ${lifeWhere}
        GROUP BY ib.parent_id
      ),
      enriched AS (
        SELECT
          p.wp_product_id, p.post_title, p.sku, p.product_type, p.image_url, p.stock_status,
          p.brand, p.sub_brand, p.category, p.sub_category,
          -- Variable : le coût est sur les déclinaisons (moyenne pondérée par leur stock,
          -- sinon moyenne simple). Pack woosb : pas de valeur de stock propre (portée par
          -- ses composants, comme au catalogue).
          CASE WHEN p.product_type = 'variable'
            THEN COALESCE(vs.value / NULLIF(vs.pos_stock, 0), vs.avg_cost, 0)
            ELSE COALESCE(p.computed_cost, p.wc_cog_cost, 0) END AS unit_cost,
          CASE WHEN p.product_type = 'woosb' THEN NULL
            WHEN p.product_type = 'variable' THEN COALESCE(vs.value, 0)
            ELSE GREATEST(COALESCE(p.stock, 0), 0) * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
          END AS stock_value,
          p.price, p.weight, p.post_date AS created_date,
          sup.name AS supplier,
          ${stockExpr} AS stock,
          COALESCE(ps.qty_sold, 0) AS qty_sold,
          COALESCE(ps.ca_ttc, 0) AS ca_ttc,
          COALESCE(ps.ca_ht, 0) AS ca_ht,
          COALESCE(ps.cost_ht, 0) AS cost_ht,
          COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0) AS margin_ht,
          CASE WHEN COALESCE(ps.ca_ht, 0) > 0
            THEN ((COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0)) / COALESCE(ps.ca_ht, 0) * 100)
            ELSE 0 END AS margin_percent,
          ls.first_sold, ls.last_sold,
          (SELECT COUNT(*) FROM products WHERE wp_parent_id = p.wp_product_id) AS variations_count
        FROM products p
        LEFT JOIN period_stats ps ON ps.parent_id = p.wp_product_id
        LEFT JOIN lifetime_stats ls ON ls.parent_id = p.wp_product_id
        LEFT JOIN var_stock vs ON vs.wp_parent_id = p.wp_product_id
        LEFT JOIN LATERAL (
          -- Fournisseur principal (product_suppliers.product_id = products.id interne)
          SELECT s.name
          FROM product_suppliers psup JOIN suppliers s ON s.id = psup.supplier_id
          WHERE psup.product_id = p.id
          ORDER BY psup.is_primary DESC NULLS LAST, psup.id ASC
          LIMIT 1
        ) sup ON true
        WHERE p.product_type IN ('simple', 'variable', 'woosb') AND p.post_status = 'publish'${searchClause}
      ),
      final AS (
        SELECT *,
          ROUND(qty_sold::numeric / ${periodDays}, 2) AS velocity,
          CASE WHEN qty_sold > 0 THEN ROUND(stock::numeric * ${periodDays} / qty_sold, 0) ELSE NULL END AS coverage_days
        FROM enriched
      )
  `;
}

// Un attribut WooCommerce est porté par la DÉCLINAISON, pas par le produit : le
// filtre restreint donc à la fois les produits retenus ET les lignes de vente
// comptées — on veut le CA des 0 mg, pas celui de tout l'e-liquide. D'où deux
// clauses jumelles, construites sur les mêmes paramètres.
const ATTR_KEY = /^attribute_pa_[a-z0-9_-]+$/i;
function buildAttributeClauses(filters, P, opts = {}) {
  const { productAlias = 'p', soldPidExpr = 'ib.sold_pid' } = opts;
  const selection = [];
  const sales = [];
  for (const f of Array.isArray(filters) ? filters : []) {
    if (!f || f.field !== 'attribute') continue;
    const key = String(f.value || '');
    const val = String(f.value2 || '');
    if (!ATTR_KEY.test(key) || !val) continue;
    const kP = P(key);
    const vP = P(val);
    const not = f.op === 'neq' ? 'NOT ' : '';
    selection.push(`${not}EXISTS (SELECT 1 FROM products av
      WHERE av.wp_parent_id = ${productAlias}.wp_product_id AND av.product_attributes->>${kP} = ${vP})`);
    sales.push(`${not}EXISTS (SELECT 1 FROM products av
      WHERE av.wp_product_id = ${soldPidExpr} AND av.product_attributes->>${kP} = ${vP})`);
  }
  return {
    selection: selection.length ? ' AND ' + selection.join(' AND ') : '',
    sales,
  };
}


module.exports = { STATS_FILTER_FIELDS, buildStatsFilterClause, buildAttributeClauses, isYmd };
