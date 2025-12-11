const pool = require('../config/database');

class ProductStatsService {
  /**
   * Récupère la famille de produits (parent + variantes)
   * Utilise le champ wp_parent_id pour identifier les variations
   */
  async getProductFamily(productId) {
    // Récupérer le produit demandé
    const productQuery = `SELECT * FROM products WHERE wp_product_id = $1`;
    const productResult = await pool.query(productQuery, [productId]);

    if (productResult.rows.length === 0) {
      return { parent: null, variants: [], allProducts: [] };
    }

    const product = productResult.rows[0];
    let parent = product;
    let parentId = productId;

    // Si le produit est une variation, récupérer le parent
    if (product.wp_parent_id) {
      const parentQuery = `SELECT * FROM products WHERE wp_product_id = $1`;
      const parentResult = await pool.query(parentQuery, [product.wp_parent_id]);
      if (parentResult.rows.length > 0) {
        parent = parentResult.rows[0];
        parentId = product.wp_parent_id;
      }
    }

    // Récupérer toutes les variantes du parent
    const variantsQuery = `
      SELECT * FROM products
      WHERE wp_parent_id = $1
      ORDER BY wp_product_id ASC
    `;
    const variantsResult = await pool.query(variantsQuery, [parentId]);
    const variants = variantsResult.rows;

    // allProducts = parent + variantes
    const allProducts = [parent, ...variants];

    return { parent, variants, allProducts };
  }

  /**
   * KPIs globaux pour un produit (avec ou sans variantes)
   * Utilise la logique bundle pour exclure les sous-produits de bundles des calculs financiers
   */
  async getProductKPIs(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

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
        SUM(oi.qty)::int as net_sold,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.line_total
        END), 0) as net_revenue,
        COUNT(DISTINCT oi.wp_order_id)::int as net_orders,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.qty * COALESCE(oi.item_cost, 0)
        END), 0) as total_cost,
        COALESCE(AVG(oi.qty), 0) as avg_quantity_per_order
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.product_id = ANY($1) AND o.post_status = 'wc-completed'
    `;

    const result = await pool.query(query, [productIds]);
    const kpis = result.rows[0];

    // Calculs
    const netRevenue = parseFloat(kpis.net_revenue) || 0;
    const totalCost = parseFloat(kpis.total_cost) || 0;

    kpis.profit = netRevenue - totalCost;
    kpis.margin_percent = netRevenue > 0 ? ((kpis.profit / netRevenue) * 100) : 0;

    return kpis;
  }

  /**
   * Stats par variante individuelle
   */
  async getVariantStats(productId) {
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.price,
        p.stock,
        p.stock_status,
        SUM(oi.qty)::int as net_sold,
        COALESCE(SUM(oi.line_total), 0) as net_revenue,
        COUNT(DISTINCT oi.wp_order_id)::int as net_orders
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = 'wc-completed'
      WHERE p.wp_product_id = $1
      GROUP BY p.wp_product_id
    `;

    const result = await pool.query(query, [productId]);
    return result.rows[0];
  }

  /**
   * Stats pour toutes les variantes d'une famille de produits
   * Utilise la logique bundle pour exclure les sous-produits de bundles des calculs financiers
   */
  async getAllVariantsStats(productId) {
    const family = await this.getProductFamily(productId);

    if (!family.variants || family.variants.length === 0) {
      return [];
    }

    const variantIds = family.variants.map(v => v.wp_product_id);

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
        p.price,
        p.wc_cog_cost as cost_price,
        p.stock,
        p.stock_status,
        COALESCE(SUM(oi.qty), 0)::int as net_sold,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.line_total
        END), 0) as net_revenue,
        COUNT(DISTINCT oi.wp_order_id)::int as net_orders,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.qty * COALESCE(oi.item_cost, 0)
        END), 0) as total_cost
      FROM products p
      LEFT JOIN order_items oi ON oi.variation_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = 'wc-completed'
      WHERE p.wp_product_id = ANY($1)
      GROUP BY p.wp_product_id, p.post_title, p.sku, p.price, p.wc_cog_cost, p.stock, p.stock_status
      ORDER BY p.sku ASC
    `;

    const result = await pool.query(query, [variantIds]);

    // Ajouter les calculs de profit et marge pour chaque variante
    return result.rows.map(variant => {
      const netRevenue = parseFloat(variant.net_revenue) || 0;
      const totalCost = parseFloat(variant.total_cost) || 0;
      const profit = netRevenue - totalCost;
      const marginPercent = netRevenue > 0 ? ((profit / netRevenue) * 100) : 0;

      return {
        ...variant,
        profit: profit.toFixed(2),
        margin_percent: marginPercent.toFixed(2)
      };
    });
  }

  /**
   * Évolution des ventes dans le temps
   * Supporte le filtrage par date et par variante spécifique
   * Utilise la logique bundle pour exclure les sous-produits de bundles des calculs financiers
   * @param {number} productId - ID du produit parent
   * @param {boolean} includeVariants - Inclure toutes les variantes
   * @param {string} groupBy - Groupement (day, week, month)
   * @param {string|null} startDate - Date de début (null = depuis la création)
   * @param {string|null} endDate - Date de fin (null = jusqu'à aujourd'hui)
   * @param {number|null} variantId - ID d'une variante spécifique (null = toutes)
   */
  async getSalesEvolution(productId, includeVariants = true, groupBy = 'day', startDate = null, endDate = null, variantId = null) {
    const family = await this.getProductFamily(productId);
    const hasVariants = family.variants && family.variants.length > 0;

    let whereClause;
    let params;
    let paramIndex;

    if (variantId) {
      // Variante spécifique demandée
      whereClause = 'oi.variation_id = $1 AND o.post_status = $2';
      params = [variantId, 'wc-completed'];
      paramIndex = 3;
    } else if (hasVariants && includeVariants) {
      // Produit variable avec variantes - chercher par variation_id
      const variantIds = family.variants.map(v => v.wp_product_id);
      whereClause = 'oi.variation_id = ANY($1) AND o.post_status = $2';
      params = [variantIds, 'wc-completed'];
      paramIndex = 3;
    } else {
      // Produit simple ou sans variantes - chercher par product_id
      whereClause = 'oi.product_id = $1 AND o.post_status = $2';
      params = [productId, 'wc-completed'];
      paramIndex = 3;
    }

    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = "TO_CHAR(o.post_date, 'YYYY-MM-DD HH24:00')";
        break;
      case 'day':
        dateFormat = "DATE(o.post_date)";
        break;
      case 'week':
        dateFormat = "DATE_TRUNC('week', o.post_date)";
        break;
      case 'month':
        dateFormat = "DATE_TRUNC('month', o.post_date)";
        break;
      default:
        dateFormat = "DATE(o.post_date)";
    }

    if (startDate) {
      whereClause += ` AND o.post_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND o.post_date <= $${paramIndex}`;
      params.push(endDate);
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
        ${dateFormat} as period,
        SUM(oi.qty)::int as quantity_sold,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.line_total
        END), 0) as revenue,
        COALESCE(SUM(CASE
          WHEN oi.id IN (SELECT order_item_id FROM bundle_sub_items) THEN 0
          ELSE oi.qty * COALESCE(oi.item_cost, 0)
        END), 0) as cost
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    const result = await pool.query(query, params);

    // Calculer le profit pour chaque période
    return result.rows.map(row => ({
      ...row,
      profit: (parseFloat(row.revenue) || 0) - (parseFloat(row.cost) || 0)
    }));
  }

  /**
   * Stats des variantes pour une période donnée (pour le panneau de sélection)
   * @param {number} productId - ID du produit parent
   * @param {string|null} startDate - Date de début (null = depuis la création)
   * @param {string|null} endDate - Date de fin (null = jusqu'à aujourd'hui)
   */
  async getVariantsStatsByPeriod(productId, startDate = null, endDate = null) {
    const family = await this.getProductFamily(productId);

    if (!family.variants || family.variants.length === 0) {
      return [];
    }

    const variantIds = family.variants.map(v => v.wp_product_id);

    // Construire les conditions de dates pour le JOIN
    let dateConditions = '';
    const params = [variantIds];
    let paramIndex = 2;

    if (startDate) {
      dateConditions += ` AND o.post_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      dateConditions += ` AND o.post_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Pour les variations, on utilise variation_id car dans WooCommerce:
    // - order_items.product_id = ID du produit parent
    // - order_items.variation_id = ID de la variation
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.stock,
        COALESCE(SUM(oi.qty), 0)::int as quantity_sold
      FROM products p
      LEFT JOIN order_items oi ON oi.variation_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id
        AND o.post_status = 'wc-completed'
        ${dateConditions}
      WHERE p.wp_product_id = ANY($1)
      GROUP BY p.wp_product_id, p.post_title, p.sku, p.stock
      ORDER BY quantity_sold DESC, p.sku ASC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Produits fréquemment achetés ensemble
   */
  async getFrequentlyBoughtWith(productId, limit = 10) {
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.image_url,
        p.price,
        COUNT(*)::int as times_bought_together
      FROM order_items oi1
      INNER JOIN order_items oi2 ON oi1.wp_order_id = oi2.wp_order_id
      INNER JOIN products p ON p.wp_product_id = oi2.product_id
      INNER JOIN orders o ON o.wp_order_id = oi1.wp_order_id
      WHERE oi1.product_id = $1
        AND oi2.product_id != $1
        AND o.post_status = 'wc-completed'
      GROUP BY p.wp_product_id, p.post_title, p.sku, p.image_url, p.price
      ORDER BY times_bought_together DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [productId, limit]);
    return result.rows;
  }

  /**
   * Ventes par pays
   */
  async getSalesByCountry(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT
        o.shipping_country,
        SUM(oi.qty)::int as net_sold,
        COALESCE(SUM(oi.line_total), 0) as net_revenue,
        COUNT(DISTINCT o.wp_order_id)::int as net_orders,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as cost,
        COALESCE(SUM(oi.line_total), 0) - COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as profit
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.product_id = ANY($1)
        AND o.post_status = 'wc-completed'
        AND o.shipping_country IS NOT NULL
      GROUP BY o.shipping_country
      ORDER BY net_revenue DESC
    `;

    const result = await pool.query(query, [productIds]);
    return result.rows;
  }

  /**
   * Top clients ayant acheté ce produit
   */
  async getTopCustomers(productId, includeVariants = true, limit = 10) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT
        c.wp_user_id,
        c.first_name,
        c.last_name,
        c.email,
        SUM(oi.qty)::int as quantity_bought,
        COALESCE(SUM(oi.line_total), 0) as total_spent,
        COUNT(DISTINCT oi.wp_order_id)::int as order_count
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      INNER JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE oi.product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY c.wp_user_id, c.first_name, c.last_name, c.email
      ORDER BY quantity_bought DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [productIds, limit]);
    return result.rows;
  }

  /**
   * Commandes récentes contenant ce produit
   */
  async getRecentOrders(productId, includeVariants = true, limit = 20) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT DISTINCT
        o.wp_order_id,
        o.wp_order_id as order_number,
        o.post_date,
        o.order_total,
        o.post_status,
        c.wp_user_id,
        c.first_name,
        c.last_name,
        c.email,
        o.shipping_country
      FROM orders o
      INNER JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE oi.product_id = ANY($1)
      ORDER BY o.post_date DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [productIds, limit]);
    return result.rows;
  }

  /**
   * Ventes par jour de la semaine
   */
  async getSalesByDayOfWeek(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT
        EXTRACT(DOW FROM o.post_date)::int as day_of_week,
        TO_CHAR(o.post_date, 'Day') as day_name,
        SUM(oi.qty)::int as quantity_sold,
        COALESCE(SUM(oi.line_total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY day_of_week, day_name
      ORDER BY day_of_week
    `;

    const result = await pool.query(query, [productIds]);
    return result.rows;
  }

  /**
   * Ventes par heure de la journée
   */
  async getSalesByHour(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT
        EXTRACT(HOUR FROM o.post_date)::int as hour,
        SUM(oi.qty)::int as quantity_sold,
        COALESCE(SUM(oi.line_total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY hour
      ORDER BY hour
    `;

    const result = await pool.query(query, [productIds]);
    return result.rows;
  }
}

module.exports = new ProductStatsService();
