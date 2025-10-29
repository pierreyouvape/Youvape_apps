const pool = require('../config/database');

class ProductStatsService {
  /**
   * Récupère la famille de produits (parent + variantes)
   * Si SKU contient un tiret, extrait le parent et trouve toutes les variantes
   */
  async getProductFamily(productId) {
    // Récupérer le produit demandé
    const productQuery = `SELECT * FROM products WHERE product_id = $1`;
    const productResult = await pool.query(productQuery, [productId]);

    if (productResult.rows.length === 0) {
      return { parent: null, variants: [] };
    }

    const product = productResult.rows[0];

    // Extraire le parent SKU
    let parentSku = product.sku;
    if (product.sku && product.sku.includes('-')) {
      parentSku = product.sku.split('-')[0];
    }

    // Récupérer tous les produits de la famille
    const familyQuery = `
      SELECT * FROM products
      WHERE sku = $1 OR sku LIKE $1 || '-%'
      ORDER BY sku ASC
    `;
    const familyResult = await pool.query(familyQuery, [parentSku]);

    // Identifier le parent (SKU sans tiret) et les variantes
    const parent = familyResult.rows.find(p => p.sku === parentSku) || familyResult.rows[0];
    const variants = familyResult.rows.filter(p => p.sku !== parentSku);

    return { parent, variants, allProducts: familyResult.rows };
  }

  /**
   * KPIs globaux pour un produit (avec ou sans variantes)
   */
  async getProductKPIs(productId, includeVariants = true) {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT
        SUM(oi.quantity)::int as net_sold,
        COALESCE(SUM(oi.total), 0) as net_revenue,
        COUNT(DISTINCT oi.order_id)::int as net_orders,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as total_cost,
        COALESCE(AVG(oi.quantity), 0) as avg_quantity_per_order
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE oi.product_id = ANY($1) AND o.status = 'completed'
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
        p.product_id,
        p.name,
        p.sku,
        p.price,
        p.stock_quantity,
        p.stock_status,
        SUM(oi.quantity)::int as net_sold,
        COALESCE(SUM(oi.total), 0) as net_revenue,
        COUNT(DISTINCT oi.order_id)::int as net_orders
      FROM products p
      LEFT JOIN order_items oi ON oi.product_id = p.product_id
      LEFT JOIN orders o ON o.order_id = oi.order_id AND o.status = 'completed'
      WHERE p.product_id = $1
      GROUP BY p.product_id
    `;

    const result = await pool.query(query, [productId]);
    return result.rows[0];
  }

  /**
   * Évolution des ventes dans le temps
   */
  async getSalesEvolution(productId, includeVariants = true, groupBy = 'day') {
    const family = await this.getProductFamily(productId);
    const productIds = includeVariants
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = "TO_CHAR(o.date_created, 'YYYY-MM-DD HH24:00')";
        break;
      case 'day':
        dateFormat = "DATE(o.date_created)";
        break;
      case 'week':
        dateFormat = "DATE_TRUNC('week', o.date_created)";
        break;
      case 'month':
        dateFormat = "DATE_TRUNC('month', o.date_created)";
        break;
      default:
        dateFormat = "DATE(o.date_created)";
    }

    const query = `
      SELECT
        ${dateFormat} as period,
        SUM(oi.quantity)::int as quantity_sold,
        COALESCE(SUM(oi.total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE oi.product_id = ANY($1) AND o.status = 'completed'
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
        p.product_id,
        p.name,
        p.sku,
        p.image_url,
        p.price,
        COUNT(*)::int as times_bought_together
      FROM order_items oi1
      INNER JOIN order_items oi2 ON oi1.order_id = oi2.order_id
      INNER JOIN products p ON p.product_id = oi2.product_id
      INNER JOIN orders o ON o.order_id = oi1.order_id
      WHERE oi1.product_id = $1
        AND oi2.product_id != $1
        AND o.status = 'completed'
      GROUP BY p.product_id
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
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT
        o.shipping_country,
        SUM(oi.quantity)::int as net_sold,
        COALESCE(SUM(oi.total), 0) as net_revenue,
        COUNT(DISTINCT o.order_id)::int as net_orders,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as cost,
        COALESCE(SUM(oi.total), 0) - COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as profit
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE oi.product_id = ANY($1)
        AND o.status = 'completed'
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
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        SUM(oi.quantity)::int as quantity_bought,
        COALESCE(SUM(oi.total), 0) as total_spent,
        COUNT(DISTINCT oi.order_id)::int as order_count
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      INNER JOIN customers c ON c.customer_id = o.customer_id
      WHERE oi.product_id = ANY($1) AND o.status = 'completed'
      GROUP BY c.customer_id
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
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT DISTINCT
        o.order_id,
        o.order_number,
        o.date_created,
        o.total,
        o.status,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        o.shipping_country
      FROM orders o
      INNER JOIN order_items oi ON oi.order_id = o.order_id
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE oi.product_id = ANY($1)
      ORDER BY o.date_created DESC
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
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT
        EXTRACT(DOW FROM o.date_created)::int as day_of_week,
        TO_CHAR(o.date_created, 'Day') as day_name,
        SUM(oi.quantity)::int as quantity_sold,
        COALESCE(SUM(oi.total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE oi.product_id = ANY($1) AND o.status = 'completed'
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
      ? family.allProducts.map(p => p.product_id)
      : [productId];

    const query = `
      SELECT
        EXTRACT(HOUR FROM o.date_created)::int as hour,
        SUM(oi.quantity)::int as quantity_sold,
        COALESCE(SUM(oi.total), 0) as revenue
      FROM order_items oi
      INNER JOIN orders o ON o.order_id = oi.order_id
      WHERE oi.product_id = ANY($1) AND o.status = 'completed'
      GROUP BY hour
      ORDER BY hour
    `;

    const result = await pool.query(query, [productIds]);
    return result.rows;
  }
}

module.exports = new ProductStatsService();
