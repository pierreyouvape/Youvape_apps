const pool = require('../config/database');
const { buildSearchCondition } = require('../utils/searchUtils');
const needsCalculationModel = require('./needsCalculationModel');

/**
 * Condition SQL pour le filtre d'onglet stock du catalogue (all/instock/outofstock/restock)
 * reorderIdsSql : liste de wp_product_id (entiers, déjà validés) séparés par des virgules,
 * issue de needsCalculationModel.getReorderProductIds() — utilisée pour le tab "restock"
 */
function stockTabCondition(alias, stockTab, reorderIdsSql) {
  switch (stockTab) {
    case 'instock': return `${alias}.stock_status = 'instock'`;
    case 'outofstock': return `${alias}.stock_status = 'outofstock'`;
    case 'restock': return `${alias}.wp_product_id IN (${reorderIdsSql})`;
    default: return null;
  }
}

/**
 * Récupère la liste des wp_product_id en besoin de réapprovisionnement (onglet "restock"),
 * prête à être inlinée dans une clause SQL IN(...). Retourne '-1' si aucun (ou tab != restock).
 */
async function getReorderIdsSql(stockTab) {
  if (stockTab !== 'restock') return '-1';
  const ids = await needsCalculationModel.getReorderProductIds();
  return ids.length > 0 ? ids.join(',') : '-1';
}

/**
 * Expressions SQL de tri pour le catalogue : pour un produit variable,
 * on agrège (somme/moyenne) sur ses variations publiées.
 */
const CATALOG_SORT_EXPRESSIONS = {
  price: `(CASE WHEN p.product_type = 'simple' THEN p.price
    ELSE (SELECT AVG(v.price) FROM products v WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish') END)`,
  cost_price: `(CASE WHEN p.product_type = 'simple' THEN COALESCE(p.computed_cost, p.wc_cog_cost)
    ELSE (SELECT AVG(COALESCE(v.computed_cost, v.wc_cog_cost)) FROM products v WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish') END)`,
  margin: `(CASE WHEN p.product_type = 'simple' THEN (p.price - COALESCE(p.computed_cost, p.wc_cog_cost))
    ELSE (SELECT AVG(v.price - COALESCE(v.computed_cost, v.wc_cog_cost)) FROM products v WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish') END)`,
  weight: `(CASE WHEN p.product_type = 'simple' THEN p.weight
    ELSE (SELECT AVG(v.weight) FROM products v WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish') END)`,
  stock: `(CASE WHEN p.product_type = 'simple' THEN COALESCE(p.stock, 0)
    ELSE (SELECT COALESCE(SUM(v.stock), 0) FROM products v WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish') END)`,
  incoming_qty: `(SELECT COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0)
    FROM purchase_order_items poi
    JOIN purchase_orders po ON poi.purchase_order_id = po.id
    WHERE po.status IN ('sent', 'confirmed', 'shipped', 'partial')
      AND poi.product_id IN (
        SELECT x.id FROM products x WHERE x.wp_product_id = p.wp_product_id
        UNION ALL
        SELECT x.id FROM products x WHERE x.wp_parent_id = p.wp_product_id AND x.product_type = 'variation'
      ))`,
  sales_30d: `(SELECT COALESCE(SUM(oi.qty), 0)
    FROM order_items oi
    JOIN orders o ON oi.wp_order_id = o.wp_order_id
    WHERE o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered')
      AND o.post_date >= NOW() - INTERVAL '30 days'
      AND (CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END) IN (
        SELECT p.wp_product_id
        UNION ALL
        SELECT x.wp_product_id FROM products x WHERE x.wp_parent_id = p.wp_product_id AND x.product_type = 'variation'
      ))`,
};

/**
 * Clause ORDER BY pour le catalogue. Retombe sur le tri par defaut (date de creation)
 * si sortBy est absent ou invalide.
 */
function catalogOrderBy(sortBy, sortDir) {
  const expr = CATALOG_SORT_EXPRESSIONS[sortBy];
  if (!expr) return 'ORDER BY p.post_date DESC';
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY ${expr} ${dir} NULLS LAST, p.post_date DESC`;
}

class ProductModel {
  /**
   * Récupère tous les produits avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        (p.price - COALESCE(p.computed_cost, p.wc_cog_cost, 0)) as unit_margin,
        COALESCE(oi_stats.times_sold, 0) as times_sold,
        COALESCE(oi_stats.total_revenue, 0) as total_revenue
      FROM products p
      LEFT JOIN (
        SELECT
          product_id,
          COUNT(DISTINCT wp_order_id) as times_sold,
          SUM(line_total) as total_revenue
        FROM order_items
        GROUP BY product_id
      ) oi_stats ON oi_stats.product_id = p.wp_product_id
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Compte le nombre total de produits
   */
  async count() {
    const result = await pool.query('SELECT COUNT(*) as total FROM products');
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère un produit par ID
   */
  async getById(wpProductId) {
    const query = `
      SELECT
        p.*,
        COALESCE(
          p.computed_cost, p.wc_cog_cost,
          (SELECT AVG(COALESCE(v.computed_cost, v.wc_cog_cost)) FROM products v WHERE v.wp_parent_id = p.wp_product_id)
        ) as cost_price,
        (p.price - COALESCE(
          p.computed_cost, p.wc_cog_cost,
          (SELECT AVG(COALESCE(v.computed_cost, v.wc_cog_cost)) FROM products v WHERE v.wp_parent_id = p.wp_product_id),
          0
        )) as unit_margin,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE product_id = p.wp_product_id) as total_revenue,
        (SELECT COUNT(DISTINCT wp_order_id) FROM order_items WHERE product_id = p.wp_product_id) as orders_count
      FROM products p
      WHERE p.wp_product_id = $1
    `;
    const result = await pool.query(query, [wpProductId]);
    return result.rows[0];
  }

  /**
   * Récupère un produit par SKU
   */
  async getBySku(sku) {
    const query = 'SELECT * FROM products WHERE sku = $1';
    const result = await pool.query(query, [sku]);
    return result.rows[0];
  }

  /**
   * Recherche de produits (nom, SKU)
   */
  async search(searchTerm, limit = 50, offset = 0) {
    const { clause, params: searchParams, nextIndex } = buildSearchCondition(searchTerm, ['p.post_title', 'p.sku'], 1);
    const query = `
      SELECT
        p.*,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        (p.price - COALESCE(p.computed_cost, p.wc_cog_cost, 0)) as unit_margin,
        COALESCE(oi_stats.total_revenue, 0) as total_revenue
      FROM products p
      LEFT JOIN (
        SELECT
          product_id,
          SUM(line_total) as total_revenue
        FROM order_items
        GROUP BY product_id
      ) oi_stats ON oi_stats.product_id = p.wp_product_id
      WHERE ${clause}
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
    `;
    const result = await pool.query(query, [...searchParams, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère l'historique des ventes d'un produit
   */
  async getSalesHistory(wpProductId, limit = 50) {
    const query = `
      SELECT
        o.wp_order_id,
        o.post_date as order_date,
        o.post_status as order_status,
        oi.qty as quantity,
        oi.line_total as total,
        COALESCE(p_cost.computed_cost, p_cost.wc_cog_cost, oi.item_cost) as cost_price
      FROM order_items oi
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p_cost ON p_cost.wp_product_id = oi.product_id
      WHERE oi.wp_product_id = $1
      ORDER BY o.post_date DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpProductId, limit]);
    return result.rows;
  }

  /**
   * Récupère les statistiques d'un produit
   */
  async getStats(wpProductId) {
    const query = `
      SELECT
        COUNT(DISTINCT oi.wp_order_id)::int as total_orders,
        COALESCE(SUM(oi.qty), 0) as total_quantity_sold,
        COALESCE(SUM(oi.line_total), 0) as total_revenue,
        COALESCE(AVG(oi.line_total / NULLIF(oi.qty, 0)), 0) as avg_price_per_unit,
        MIN(o.post_date) as first_sale_date,
        MAX(o.post_date) as last_sale_date
      FROM products p
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = ANY(ARRAY['wc-completed', 'wc-delivered', 'wc-processing', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'])
      WHERE p.wp_product_id = $1
    `;

    const result = await pool.query(query, [wpProductId]);
    const stats = result.rows[0];

    // Calcul du coût total
    const costQuery = `
      SELECT COALESCE(SUM(oi.qty * COALESCE(p_cost.computed_cost, p_cost.wc_cog_cost, 0)), 0) as total_cost
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      LEFT JOIN products p_cost ON p_cost.wp_product_id = oi.product_id
      WHERE oi.wp_product_id = $1 AND o.post_status = ANY(ARRAY['wc-completed', 'wc-delivered', 'wc-processing', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'])
    `;

    const costResult = await pool.query(costQuery, [wpProductId]);
    stats.total_cost = parseFloat(costResult.rows[0]?.total_cost || 0);

    // Calcul profit et marge
    const totalRevenue = parseFloat(stats.total_revenue) || 0;
    const totalCost = parseFloat(stats.total_cost) || 0;

    stats.total_profit = totalRevenue - totalCost;
    stats.margin_percent = totalRevenue > 0 ? ((stats.total_profit / totalRevenue) * 100) : 0;

    return stats;
  }

  /**
   * Récupère les clients qui ont acheté ce produit
   */
  async getCustomers(wpProductId, limit = 50) {
    const query = `
      SELECT
        c.wp_user_id,
        c.email,
        c.first_name,
        c.last_name,
        COUNT(DISTINCT oi.wp_order_id) as orders_count,
        SUM(oi.qty) as total_quantity,
        SUM(oi.line_total) as total_spent
      FROM order_items oi
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE oi.wp_product_id = $1 AND o.post_status = ANY(ARRAY['wc-completed', 'wc-delivered', 'wc-processing', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered'])
      GROUP BY c.wp_user_id, c.email, c.first_name, c.last_name
      ORDER BY total_quantity DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpProductId, limit]);
    return result.rows;
  }

  /**
   * Récupère les variations d'un produit parent
   */
  async getVariations(wpParentId) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_revenue
      FROM products p
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY p.post_title ASC
    `;
    const result = await pool.query(query, [wpParentId]);
    return result.rows;
  }

  /**
   * Crée un nouveau produit
   */
  async create(productData) {
    const query = `
      INSERT INTO products (
        wp_product_id, wp_parent_id, product_type, post_title, sku,
        price, regular_price, wc_cog_cost, stock, stock_status, post_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      productData.wp_product_id,
      productData.wp_parent_id || null,
      productData.product_type || 'simple',
      productData.post_title,
      productData.sku || null,
      productData.price || null,
      productData.regular_price || null,
      productData.wc_cog_cost || null,
      productData.stock || null,
      productData.stock_status || null,
      productData.post_status || 'publish'
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Met à jour un produit
   */
  async update(wpProductId, productData) {
    const query = `
      UPDATE products
      SET
        post_title = $1,
        sku = $2,
        price = $3,
        regular_price = $4,
        wc_cog_cost = $5,
        stock = $6,
        stock_status = $7,
        post_status = $8,
        updated_at = NOW()
      WHERE wp_product_id = $9
      RETURNING *
    `;
    const values = [
      productData.post_title,
      productData.sku || null,
      productData.price || null,
      productData.regular_price || null,
      productData.wc_cog_cost || null,
      productData.stock || null,
      productData.stock_status || null,
      productData.post_status || 'publish',
      wpProductId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Active/désactive le suivi de stock (équivalent ATUM Control Switch)
   * pour un produit ou une déclinaison
   */
  async setTrackStock(productId, trackStock) {
    const result = await pool.query(
      `UPDATE products SET track_stock = $1, updated_at = NOW() WHERE id = $2 RETURNING id, track_stock`,
      [trackStock, productId]
    );
    return result.rows[0];
  }

  /**
   * Supprime un produit
   */
  async delete(wpProductId) {
    const query = 'DELETE FROM products WHERE wp_product_id = $1 RETURNING *';
    const result = await pool.query(query, [wpProductId]);
    return result.rows[0];
  }

  /**
   * Récupère le résumé des stocks
   */
  async getStockSummary() {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE stock_status = 'instock') as in_stock,
        COUNT(*) FILTER (WHERE stock_status = 'outofstock') as out_of_stock,
        COUNT(*) FILTER (WHERE stock IS NOT NULL AND CAST(stock AS INTEGER) > 0 AND CAST(stock AS INTEGER) <= 10) as low_stock
      FROM products
      WHERE post_status = 'publish'
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Récupère la famille de produits (parent + toutes ses variations)
   */
  async getFamily(wpProductId) {
    // D'abord déterminer si c'est un parent ou une variation
    const productQuery = `
      SELECT wp_product_id, wp_parent_id, product_type
      FROM products
      WHERE wp_product_id = $1
    `;
    const productResult = await pool.query(productQuery, [wpProductId]);

    if (productResult.rows.length === 0) {
      return null;
    }

    const product = productResult.rows[0];
    const parentId = product.wp_parent_id || product.wp_product_id;

    // Récupère le parent et toutes les variations
    const familyQuery = `
      SELECT
        p.*,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        (p.price - COALESCE(p.computed_cost, p.wc_cog_cost, 0)) as unit_margin,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_revenue
      FROM products p
      WHERE p.wp_product_id = $1 OR p.wp_parent_id = $1
      ORDER BY p.product_type DESC, p.post_title ASC
    `;
    const result = await pool.query(familyQuery, [parentId]);
    return result.rows;
  }

  /**
   * Récupère les statistiques de variations d'un produit
   */
  async getVariantStats(wpProductId) {
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.product_attributes,
        p.stock,
        p.stock_status,
        p.price,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        COALESCE(SUM(oi.qty), 0) as total_sold,
        COALESCE(SUM(oi.line_total), 0) as total_revenue,
        COALESCE(SUM(oi.qty * COALESCE(p.computed_cost, p.wc_cog_cost, 0)), 0) as total_cost
      FROM products p
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      GROUP BY p.wp_product_id, p.post_title, p.product_attributes, p.stock, p.stock_status, p.price, p.wc_cog_cost, p.computed_cost
      ORDER BY total_sold DESC
    `;
    const result = await pool.query(query, [wpProductId]);
    return result.rows;
  }

  /**
   * Récupère les produits pour l'onglet Stats avec pagination
   * Produits parents uniquement (simple + variable) avec stats agrégées
   * Exclut les commandes failed et cancelled
   */
  async getAllForStats(limit = 50, offset = 0, searchTerm = '', sortBy = 'qty_sold', sortOrder = 'DESC', dateFrom = null, dateTo = null) {
    let whereClause = "WHERE p.product_type IN ('simple', 'variable', 'woosb') AND p.post_status = 'publish'";
    let params = [];
    let paramIndex = 1;

    if (searchTerm) {
      const { clause, params: searchParams, nextIndex } = buildSearchCondition(searchTerm, ['p.post_title', 'p.sku'], paramIndex);
      whereClause += ` AND ${clause}`;
      params.push(...searchParams);
      paramIndex = nextIndex;
    }

    // Filtre de dates pour les commandes
    let dateFilter = '';
    if (dateFrom) {
      dateFilter += ` AND o.post_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      dateFilter += ` AND o.post_date < $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    // Colonnes triables
    const sortColumns = {
      'name': 'p.post_title',
      'sku': 'p.sku',
      'stock': 'stock',
      'qty_sold': 'qty_sold',
      'ca_ttc': 'ca_ttc',
      'ca_ht': 'ca_ht',
      'cost_ht': 'cost_ht',
      'margin_ht': 'margin_ht',
      'margin_percent': 'margin_percent'
    };
    const orderColumn = sortColumns[sortBy] || 'qty_sold';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    params.push(limit, offset);
    const limitParam = paramIndex;
    const offsetParam = paramIndex + 1;

    const query = `
      WITH product_family AS (
        -- Créer une relation produit parent -> tous ses IDs (lui-même + variations)
        SELECT
          p.wp_product_id as parent_id,
          COALESCE(v.wp_product_id, p.wp_product_id) as product_id
        FROM products p
        LEFT JOIN products v ON v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
        WHERE p.product_type IN ('simple', 'variable', 'woosb') AND p.post_status = 'publish'
      ),
      bundle_sub_items AS (
        -- Identifier les lignes de commande qui sont des sous-produits de bundles
        -- Ce sont les produits vendus à 0€ qui apparaissent dans le woosb_ids d'un bundle dans la même commande
        SELECT DISTINCT
          oi.id as order_item_id
        FROM order_items oi
        INNER JOIN order_items oi_bundle ON oi.wp_order_id = oi_bundle.wp_order_id
        INNER JOIN products p_bundle ON p_bundle.wp_product_id = oi_bundle.product_id
        WHERE
          p_bundle.product_type = 'woosb'
          AND p_bundle.woosb_ids IS NOT NULL
          AND oi.line_total = 0
          AND oi.product_id::text = ANY(
            SELECT jsonb_array_elements_text(
              jsonb_path_query_array(p_bundle.woosb_ids, '$[*].id')
            )
          )
      ),
      product_stats AS (
        -- Agréger les stats par produit parent
        -- Quantité : TOUT compter (bundle + ventes individuelles)
        -- Financier : UNIQUEMENT les ventes réelles (exclure bundle sub-items)
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          pf.parent_id,
          SUM(oi.qty)::int as qty_sold,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE COALESCE(oi.line_total, 0) + COALESCE(oi.line_tax, 0)
          END) as ca_ttc,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE COALESCE(oi.line_total, 0)
          END) as ca_ht,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE oi.qty * COALESCE(p_cost.computed_cost, p_cost.wc_cog_cost, 0)
          END) as cost_ht
        FROM product_family pf
        INNER JOIN order_items oi ON (oi.product_id = pf.product_id OR oi.variation_id = pf.product_id)
        INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
          AND o.post_status NOT IN ('wc-failed', 'wc-cancelled')
          ${dateFilter}
        LEFT JOIN products p_cost ON p_cost.wp_product_id = oi.product_id
        GROUP BY pf.parent_id
      )
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.product_type,
        p.image_url,
        CASE
          WHEN p.product_type = 'variable' THEN (
            SELECT COALESCE(SUM(v.stock::int), 0)
            FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
          )
          ELSE COALESCE(p.stock::int, 0)
        END as stock,
        p.stock_status,
        COALESCE(ps.qty_sold, 0) as qty_sold,
        COALESCE(ps.ca_ttc, 0) as ca_ttc,
        COALESCE(ps.ca_ht, 0) as ca_ht,
        COALESCE(ps.cost_ht, 0) as cost_ht,
        COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(ps.ca_ht, 0) > 0
          THEN ((COALESCE(ps.ca_ht, 0) - COALESCE(ps.cost_ht, 0)) / COALESCE(ps.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent,
        (SELECT COUNT(*) FROM products WHERE wp_parent_id = p.wp_product_id) as variations_count
      FROM products p
      LEFT JOIN product_stats ps ON ps.parent_id = p.wp_product_id
      ${whereClause}
      ORDER BY ${orderColumn} ${order} NULLS LAST
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Compte les produits pour l'onglet Stats
   */
  async countForStats(searchTerm = '') {
    let whereClause = "WHERE product_type IN ('simple', 'variable', 'woosb') AND post_status = 'publish'";
    let params = [];

    if (searchTerm) {
      const { clause, params: searchParams } = buildSearchCondition(searchTerm, ['post_title', 'sku'], 1);
      whereClause += ` AND ${clause}`;
      params.push(...searchParams);
    }

    const query = `SELECT COUNT(*)::int as total FROM products ${whereClause}`;
    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère les variations d'un produit avec leurs stats
   */
  async getVariationsForStats(wpParentId, dateFrom = null, dateTo = null) {
    let params = [wpParentId];
    let dateFilter = '';
    let paramIndex = 2;

    if (dateFrom) {
      dateFilter += ` AND o.post_date >= $${paramIndex}`;
      params.push(dateFrom);
      paramIndex++;
    }
    if (dateTo) {
      dateFilter += ` AND o.post_date < $${paramIndex}`;
      params.push(dateTo);
      paramIndex++;
    }

    const query = `
      WITH bundle_sub_items AS (
        -- Identifier les lignes de commande qui sont des sous-produits de bundles
        SELECT DISTINCT
          oi.id as order_item_id
        FROM order_items oi
        INNER JOIN order_items oi_bundle ON oi.wp_order_id = oi_bundle.wp_order_id
        INNER JOIN products p_bundle ON p_bundle.wp_product_id = oi_bundle.product_id
        WHERE
          p_bundle.product_type = 'woosb'
          AND p_bundle.woosb_ids IS NOT NULL
          AND oi.line_total = 0
          AND oi.product_id::text = ANY(
            SELECT jsonb_array_elements_text(
              jsonb_path_query_array(p_bundle.woosb_ids, '$[*].id')
            )
          )
      )
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        COALESCE(p.stock::int, 0) as stock,
        p.stock_status,
        p.product_attributes,
        COALESCE(stats.qty_sold, 0)::int as qty_sold,
        COALESCE(stats.ca_ttc, 0) as ca_ttc,
        COALESCE(stats.ca_ht, 0) as ca_ht,
        COALESCE(stats.cost_ht, 0) as cost_ht,
        COALESCE(stats.ca_ht, 0) - COALESCE(stats.cost_ht, 0) as margin_ht,
        CASE WHEN COALESCE(stats.ca_ht, 0) > 0
          THEN ((COALESCE(stats.ca_ht, 0) - COALESCE(stats.cost_ht, 0)) / COALESCE(stats.ca_ht, 0) * 100)
          ELSE 0
        END as margin_percent
      FROM products p
      LEFT JOIN LATERAL (
        -- WooCommerce: line_total = HT, line_tax = TVA, donc TTC = line_total + line_tax
        SELECT
          SUM(oi.qty) as qty_sold,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE COALESCE(oi.line_total, 0) + COALESCE(oi.line_tax, 0)
          END) as ca_ttc,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE COALESCE(oi.line_total, 0)
          END) as ca_ht,
          SUM(CASE
            WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
            ELSE oi.qty * COALESCE(p_cost2.computed_cost, p_cost2.wc_cog_cost, 0)
          END) as cost_ht
        FROM order_items oi
        INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
        LEFT JOIN products p_cost2 ON p_cost2.wp_product_id = oi.product_id
        WHERE (oi.product_id = p.wp_product_id OR oi.variation_id = p.wp_product_id)
        AND o.post_status NOT IN ('wc-failed', 'wc-cancelled')
        ${dateFilter}
      ) stats ON true
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY qty_sold DESC NULLS LAST
    `;
    const result = await pool.query(query, params);
    return result.rows;
  }
  /**
   * Récupère les produits pour le catalogue (paramétrage)
   * Produits simples publiés + variations dont le parent est publish
   * Tri par date de création DESC
   */
  async getBrandsForCatalog() {
    const result = await pool.query(`
      SELECT type, value, parent FROM (
        SELECT 'brand' as type, brand as value, NULL::text as parent
        FROM products
        WHERE brand IS NOT NULL AND product_type IN ('simple','variable') AND post_status = 'publish'
        GROUP BY brand

        UNION ALL

        SELECT 'sub_brand' as type, sub_brand as value, brand as parent
        FROM products
        WHERE sub_brand IS NOT NULL AND product_type IN ('simple','variable') AND post_status = 'publish'
        GROUP BY sub_brand, brand
      ) t
      ORDER BY
        CASE WHEN type = 'brand' THEN value ELSE parent END,
        type,
        value
    `);
    return result.rows;
  },

  async getAllForCatalog(limit = 50, offset = 0, search = '', trackStockOnly = true, stockTab = 'all', sortBy = null, sortDir = 'desc', brand = '', onlyHidden = false, subBrand = '') {
    const reorderIdsSql = await getReorderIdsSql(stockTab);
    let whereClause = `
      WHERE p.post_status = 'publish'
        AND p.product_type IN ('simple', 'variable')
    `;
    if (trackStockOnly) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND p.track_stock = true)
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.track_stock = true
          ))
        )
      `;
    }
    if (onlyHidden) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND p.track_stock = false)
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.track_stock = false
          ))
        )
      `;
    }
    const stockCond = stockTabCondition('p', stockTab, reorderIdsSql);
    const stockCondVar = stockTabCondition('v', stockTab, reorderIdsSql);
    if (stockCond) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND ${stockCond})
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
              ${trackStockOnly ? 'AND v.track_stock = true' : onlyHidden ? 'AND v.track_stock = false' : ''}
              AND ${stockCondVar}
          ))
        )
      `;
    }
    const params = [];
    let paramIndex = 1;

    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      const wordClauses = words.map((w, i) => {
        const p = paramIndex + i;
        const isShort = w.length <= 2;
        const pField = `unaccent(p.post_title || ' ' || COALESCE(p.sku, '') || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.sub_brand, ''))`;
        const vField = `unaccent(v.post_title || ' ' || COALESCE(v.sku, '') || ' ' || COALESCE(v.brand, '') || ' ' || COALESCE(v.sub_brand, ''))`;
        const pCond = isShort ? `(' ' || ${pField} || ' ') ILIKE unaccent($${p})` : `${pField} ILIKE unaccent($${p})`;
        const vCond = isShort ? `(' ' || ${vField} || ' ') ILIKE unaccent($${p})` : `${vField} ILIKE unaccent($${p})`;
        return `(
          ${pCond}
          OR EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
              AND ${vCond}
          )
        )`;
      });
      whereClause += ' AND ' + wordClauses.join(' AND ');
      words.forEach(w => params.push(w.length <= 2 ? `% ${w} %` : `%${w}%`));
      paramIndex += words.length;
    }

    if (brand) {
      whereClause += ` AND p.brand = $${paramIndex}`;
      params.push(brand);
      paramIndex++;
    }
    if (subBrand) {
      whereClause += ` AND p.sub_brand = $${paramIndex}`;
      params.push(subBrand);
      paramIndex++;
    }

    params.push(limit, offset);

    // 1) Parents/simples paginés
    const parentsQuery = `
      SELECT
        p.id,
        p.wp_product_id,
        p.post_title,
        p.sku,
        COALESCE(p.stock, 0)::int as stock,
        p.price,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        p.weight,
        p.image_url,
        p.product_type,
        p.post_date,
        p.track_stock
      FROM products p
      ${whereClause}
      ${catalogOrderBy(sortBy, sortDir)}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    const parentsResult = await pool.query(parentsQuery, params);
    const parents = parentsResult.rows;

    // 2) Récupérer les wp_product_id des parents variable
    const variableIds = parents
      .filter(p => p.product_type === 'variable')
      .map(p => p.wp_product_id);

    let variations = [];
    if (variableIds.length > 0) {
      // Filtre variations : une déclinaison est montrée si le PARENT correspond à la recherche
      // (ex: "Pulp Fraise des bois" → toutes ses déclinaisons "50ml", "100ml")
      // OU si la DÉCLINAISON elle-même correspond (ex: "Mozambique 12mg" dans un parent générique
      // "Curieux" → seules les déclinaisons "Mozambique" sont montrées, pas "Cassis Givré").
      const varParams = [variableIds]; // $1 = variableIds
      let varFilter = '';
      if (search) {
        const words = search.trim().split(/\s+/).filter(Boolean);
        const pField = `unaccent(p_parent.post_title || ' ' || COALESCE(p_parent.sku, '') || ' ' || COALESCE(p_parent.brand, '') || ' ' || COALESCE(p_parent.sub_brand, ''))`;
        const vField = `unaccent(v.post_title || ' ' || COALESCE(v.sku, '') || ' ' || COALESCE(v.brand, '') || ' ' || COALESCE(v.sub_brand, ''))`;
        const wordClauses = words.map((w, i) => {
          const p = varParams.length + 1 + i;
          const isShort = w.length <= 2;
          const pCond = isShort ? `(' ' || ${pField} || ' ') ILIKE unaccent($${p})` : `${pField} ILIKE unaccent($${p})`;
          const vCond = isShort ? `(' ' || ${vField} || ' ') ILIKE unaccent($${p})` : `${vField} ILIKE unaccent($${p})`;
          return `(${pCond} OR ${vCond})`;
        });
        varFilter += ' AND ' + wordClauses.join(' AND ');
        words.forEach(w => varParams.push(w.length <= 2 ? `% ${w} %` : `%${w}%`));
      }
      if (brand) {
        varFilter += ` AND (v.brand = $${varParams.length + 1} OR p_parent.brand = $${varParams.length + 1})`;
        varParams.push(brand);
      }
      if (subBrand) {
        varFilter += ` AND p_parent.sub_brand = $${varParams.length + 1}`;
        varParams.push(subBrand);
      }

      const variationsQuery = `
        SELECT
          v.id,
          v.wp_product_id,
          v.wp_parent_id,
          v.post_title,
          v.sku,
          COALESCE(v.stock, 0)::int as stock,
          v.price,
          COALESCE(v.computed_cost, v.wc_cog_cost) as cost_price,
          v.weight,
          COALESCE(v.image_url, p_parent.image_url) as image_url,
          v.product_type,
          v.track_stock
        FROM products v
        LEFT JOIN products p_parent ON v.wp_parent_id = p_parent.wp_product_id
        WHERE v.wp_parent_id = ANY($1) AND v.product_type = 'variation'
          ${trackStockOnly ? 'AND v.track_stock = true' : onlyHidden ? 'AND v.track_stock = false' : ''}
          ${stockCondVar ? `AND ${stockCondVar}` : ''}
          ${varFilter}
        ORDER BY v.post_title ASC
      `;
      const variationsResult = await pool.query(variationsQuery, varParams);
      variations = variationsResult.rows;
    }

    // 3) Arrivages en cours (par product internal id)
    const allIds = [...parents.map(p => p.id), ...variations.map(v => v.id)];
    let incomingMap = new Map();
    if (allIds.length > 0) {
      const incomingResult = await pool.query(`
        SELECT poi.product_id, COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0)::int as incoming_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.purchase_order_id = po.id
        WHERE po.status IN ('sent', 'confirmed', 'shipped', 'partial')
          AND poi.product_id = ANY($1)
        GROUP BY poi.product_id
      `, [allIds]);
      for (const row of incomingResult.rows) {
        incomingMap.set(parseInt(row.product_id), parseInt(row.incoming_qty) || 0);
      }
    }

    // 4) Ventes 30 derniers jours (par wp_product_id)
    const allWpIds = [...parents.map(p => parseInt(p.wp_product_id)), ...variations.map(v => parseInt(v.wp_product_id))];
    let salesMap = new Map();
    if (allWpIds.length > 0) {
      const salesResult = await pool.query(`
        SELECT
          CASE WHEN oi.variation_id > 0 THEN oi.variation_id ELSE oi.product_id END as wp_id,
          COALESCE(SUM(oi.qty), 0)::int as sales_30d
        FROM order_items oi
        JOIN orders o ON oi.wp_order_id = o.wp_order_id
        WHERE o.post_status IN ('wc-completed', 'wc-processing', 'wc-delivered', 'wc-awaiting-delivery', 'wc-shipped', 'wc-being-delivered')
          AND o.post_date >= NOW() - INTERVAL '30 days'
          AND (oi.product_id = ANY($1) OR oi.variation_id = ANY($1))
        GROUP BY wp_id
      `, [allWpIds]);
      for (const row of salesResult.rows) {
        salesMap.set(parseInt(row.wp_id), parseInt(row.sales_30d) || 0);
      }
    }

    // 5) Enrichir les données
    const enrichProduct = (p) => ({
      ...p,
      incoming_qty: incomingMap.get(p.id) || 0,
      sales_30d: salesMap.get(parseInt(p.wp_product_id)) || 0
    });

    return {
      parents: parents.map(enrichProduct),
      variations: variations.map(enrichProduct)
    };
  }

  /**
   * Compte les produits pour le catalogue
   */
  async countForCatalog(search = '', trackStockOnly = true, stockTab = 'all', brand = '', onlyHidden = false, subBrand = '') {
    const reorderIdsSql = await getReorderIdsSql(stockTab);
    let whereClause = `
      WHERE p.post_status = 'publish'
        AND p.product_type IN ('simple', 'variable')
    `;
    if (trackStockOnly) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND p.track_stock = true)
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.track_stock = true
          ))
        )
      `;
    }
    if (onlyHidden) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND p.track_stock = false)
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.track_stock = false
          ))
        )
      `;
    }
    const stockCond = stockTabCondition('p', stockTab, reorderIdsSql);
    const stockCondVar = stockTabCondition('v', stockTab, reorderIdsSql);
    if (stockCond) {
      whereClause += `
        AND (
          (p.product_type = 'simple' AND ${stockCond})
          OR (p.product_type = 'variable' AND EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
              ${trackStockOnly ? 'AND v.track_stock = true' : onlyHidden ? 'AND v.track_stock = false' : ''}
              AND ${stockCondVar}
          ))
        )
      `;
    }
    const params = [];

    if (search) {
      const words = search.trim().split(/\s+/).filter(Boolean);
      let idx = 1;
      const wordClauses = words.map((w, i) => {
        const p = idx + i;
        const isShort = w.length <= 2;
        const pField = `unaccent(p.post_title || ' ' || COALESCE(p.sku, '') || ' ' || COALESCE(p.brand, '') || ' ' || COALESCE(p.sub_brand, ''))`;
        const vField = `unaccent(v.post_title || ' ' || COALESCE(v.sku, '') || ' ' || COALESCE(v.brand, '') || ' ' || COALESCE(v.sub_brand, ''))`;
        const pCond = isShort ? `(' ' || ${pField} || ' ') ILIKE unaccent($${p})` : `${pField} ILIKE unaccent($${p})`;
        const vCond = isShort ? `(' ' || ${vField} || ' ') ILIKE unaccent($${p})` : `${vField} ILIKE unaccent($${p})`;
        return `(
          ${pCond}
          OR EXISTS (
            SELECT 1 FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
              AND ${vCond}
          )
        )`;
      });
      whereClause += ' AND ' + wordClauses.join(' AND ');
      words.forEach(w => params.push(w.length <= 2 ? `% ${w} %` : `%${w}%`));
    }

    if (brand) {
      whereClause += ` AND p.brand = $${params.length + 1}`;
      params.push(brand);
    }
    if (subBrand) {
      whereClause += ` AND p.sub_brand = $${params.length + 1}`;
      params.push(subBrand);
    }

    const query = `
      SELECT
        COUNT(*)::int as total,
        COALESCE(SUM(
          CASE WHEN p.product_type = 'simple' THEN 1
            ELSE (
              SELECT COUNT(*) FROM products v
              WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation'
                ${trackStockOnly ? 'AND v.track_stock = true' : onlyHidden ? 'AND v.track_stock = false' : ''}
                ${stockCondVar ? `AND ${stockCondVar}` : ''}
            )
          END
        ), 0)::int as total_with_variations,
        COALESCE(SUM(
          CASE WHEN p.product_type = 'simple' THEN
            GREATEST(COALESCE(p.stock, 0), 0) * COALESCE(p.computed_cost, p.wc_cog_cost, 0)
          ELSE (
            SELECT COALESCE(SUM(GREATEST(COALESCE(v.stock, 0), 0) * COALESCE(v.computed_cost, v.wc_cog_cost, 0)), 0)
            FROM products v
            WHERE v.wp_parent_id = p.wp_product_id AND v.product_type = 'variation' AND v.post_status = 'publish'
          )
          END
        ), 0) as total_stock_value
      FROM products p
      ${whereClause}
    `;

    const result = await pool.query(query, params);
    return {
      total: parseInt(result.rows[0].total),
      totalWithVariations: parseInt(result.rows[0].total_with_variations),
      totalStockValue: parseFloat(result.rows[0].total_stock_value) || 0,
    };
  }

  /**
   * Récupère les données d'un produit pour la fiche catalogue
   * Inclut stock, arrivages en cours, et données pour le calcul des besoins
   */
  async getForCatalogDetail(productId) {
    // Données produit
    const productResult = await pool.query(`
      SELECT
        p.id,
        p.wp_product_id,
        p.post_title,
        p.sku,
        COALESCE(p.stock, 0) as stock,
        p.stock_status,
        p.regular_price,
        COALESCE(p.computed_cost, p.wc_cog_cost) as cost_price,
        COALESCE(p.image_url, p_parent.image_url) as image_url,
        p.product_type,
        p.wp_parent_id,
        p.post_date
      FROM products p
      LEFT JOIN products p_parent ON p.wp_parent_id = p_parent.wp_product_id
      WHERE p.id = $1
    `, [productId]);

    if (productResult.rows.length === 0) return null;
    const product = productResult.rows[0];

    // Arrivages en cours
    const incomingResult = await pool.query(`
      SELECT COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0) as incoming_qty
      FROM purchase_order_items poi
      JOIN purchase_orders po ON poi.purchase_order_id = po.id
      WHERE poi.product_id = $1
        AND po.status IN ('sent', 'confirmed', 'shipped', 'partial')
    `, [productId]);

    product.incoming_qty = parseInt(incomingResult.rows[0].incoming_qty) || 0;

    // Codes-barres
    const barcodesResult = await pool.query(
      'SELECT id, barcode, type, quantity FROM product_barcodes WHERE product_id = $1 ORDER BY type, id',
      [productId]
    );
    product.barcodes = barcodesResult.rows;

    return product;
  }

  async getBarcodes(productId) {
    const result = await pool.query(
      'SELECT id, barcode, type, quantity, created_at FROM product_barcodes WHERE product_id = $1 ORDER BY type, id',
      [productId]
    );
    return result.rows;
  }

  async addBarcode(productId, barcode, type, quantity = null) {
    const result = await pool.query(
      'INSERT INTO product_barcodes (product_id, barcode, type, quantity) VALUES ($1, $2, $3, $4) RETURNING *',
      [productId, barcode, type, quantity]
    );
    return result.rows[0];
  }

  async deleteBarcode(barcodeId) {
    const result = await pool.query(
      'DELETE FROM product_barcodes WHERE id = $1 RETURNING id',
      [barcodeId]
    );
    return result.rows[0];
  }

  async importBarcodes(rows) {
    const results = { inserted: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      try {
        const product = await pool.query('SELECT id FROM products WHERE sku = $1', [row.sku]);
        if (!product.rows[0]) {
          results.errors.push({ sku: row.sku, barcode: row.barcode, reason: 'SKU introuvable' });
          continue;
        }
        await pool.query(
          'INSERT INTO product_barcodes (product_id, barcode, type) VALUES ($1, $2, $3) ON CONFLICT (product_id, barcode) DO NOTHING',
          [product.rows[0].id, row.barcode, 'unit']
        );
        results.inserted++;
      } catch (err) {
        results.errors.push({ sku: row.sku, barcode: row.barcode, reason: err.message });
      }
    }
    return results;
  }
}

module.exports = new ProductModel();
