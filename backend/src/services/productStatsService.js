const pool = require('../config/database');

class ProductStatsService {
  /**
   * Récupère la famille de produits (parent + variantes)
   * Utilise le champ parent_id pour identifier les variations
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
    if (product.parent_id) {
      const parentQuery = `SELECT * FROM products WHERE wp_product_id = $1`;
      const parentResult = await pool.query(parentQuery, [product.parent_id]);
      if (parentResult.rows.length > 0) {
        parent = parentResult.rows[0];
        parentId = product.parent_id;
      }
    }

    // Récupérer toutes les variantes du parent
    const variantsQuery = `
      SELECT * FROM products
      WHERE parent_id = $1
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
   */
  async getProductKPIs(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

    const query = `
      SELECT
        SUM(oi.qty)::int as net_sold,
        COALESCE(SUM(oi.line_total), 0) as net_revenue,
        COUNT(DISTINCT oi.wp_order_id)::int as net_orders,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as total_cost,
        COALESCE(AVG(oi.qty), 0) as avg_quantity_per_order
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.wp_product_id = ANY($1) AND o.post_status = 'wc-completed'
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
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = 'wc-completed'
      WHERE p.wp_product_id = $1
      GROUP BY p.wp_product_id
    `;

    const result = await pool.query(query, [productId]);
    return result.rows[0];
  }

  /**
   * Stats pour toutes les variantes d'une famille de produits
   */
  async getAllVariantsStats(productId) {
    const family = await this.getProductFamily(productId);

    if (!family.variants || family.variants.length === 0) {
      return [];
    }

    const variantIds = family.variants.map(v => v.wp_product_id);

    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.sku,
        p.price,
        COALESCE(p.cost_price_custom, p.cost_price) as cost_price,
        p.stock,
        p.stock_status,
        COALESCE(SUM(oi.qty), 0)::int as net_sold,
        COALESCE(SUM(oi.line_total), 0) as net_revenue,
        COUNT(DISTINCT oi.wp_order_id)::int as net_orders,
        COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as total_cost
      FROM products p
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = 'wc-completed'
      WHERE p.wp_product_id = ANY($1)
      GROUP BY p.wp_product_id
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
   */
  async getSalesEvolution(productId, includeVariants = true, groupBy = 'day') {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.wp_product_id)
      : [productId];

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

    const query = `
      SELECT
        ${dateFormat} as period,
        SUM(oi.qty)::int as quantity_sold,
        COALESCE(SUM(oi.line_total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.wp_product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY period
      ORDER BY period ASC
    `;

    const result = await pool.query(query, [productIds]);
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
      INNER JOIN products p ON p.wp_product_id = oi2.wp_product_id
      INNER JOIN orders o ON o.wp_order_id = oi1.wp_order_id
      WHERE oi1.wp_product_id = $1
        AND oi2.wp_product_id != $1
        AND o.post_status = 'wc-completed'
      GROUP BY p.wp_product_id
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
      WHERE oi.wp_product_id = ANY($1)
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
      WHERE oi.wp_product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY c.wp_user_id
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
        o.order_number,
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
      WHERE oi.wp_product_id = ANY($1)
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
      WHERE oi.wp_product_id = ANY($1) AND o.post_status = 'wc-completed'
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
      WHERE oi.wp_product_id = ANY($1) AND o.post_status = 'wc-completed'
      GROUP BY hour
      ORDER BY hour
    `;

    const result = await pool.query(query, [productIds]);
    return result.rows;
  }
}

module.exports = new ProductStatsService();
