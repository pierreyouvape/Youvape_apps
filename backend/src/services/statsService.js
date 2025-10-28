const pool = require('../config/database');

class StatsService {
  /**
   * Calcule les KPI globaux du dashboard
   * @param {Object} filters - { period: '30d', status: 'completed', country: 'FR' }
   */
  async getDashboardKPIs(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        COUNT(DISTINCT o.order_id) as total_orders,
        COUNT(DISTINCT o.customer_id) as unique_customers,
        COALESCE(SUM(o.total), 0) as total_revenue,
        COALESCE(AVG(o.total), 0) as avg_order_value,
        COALESCE(SUM(o.discount_total), 0) as total_discounts,
        COALESCE(SUM(o.shipping_total), 0) as total_shipping_charged,
        COALESCE(SUM(o.shipping_cost_real), 0) as total_shipping_real_cost,
        COALESCE(SUM(o.tax_total), 0) as total_tax,
        -- Calcul du coût total des produits vendus
        COALESCE(
          (SELECT SUM(oi.quantity * COALESCE(oi.cost_price, 0))
           FROM order_items oi
           WHERE oi.order_id IN (
             SELECT order_id FROM orders ${whereClause}
           )), 0
        ) as total_products_cost
      FROM orders o
      ${whereClause}
    `;

    const result = await pool.query(query, params);
    const kpis = result.rows[0];

    // Calcul de la marge brute
    const totalRevenue = parseFloat(kpis.total_revenue);
    const totalProductsCost = parseFloat(kpis.total_products_cost);
    const totalShippingCost = parseFloat(kpis.total_shipping_real_cost) || parseFloat(kpis.total_shipping_charged);

    kpis.gross_margin = totalRevenue - totalProductsCost - totalShippingCost;
    kpis.gross_margin_percent = totalRevenue > 0 ? (kpis.gross_margin / totalRevenue * 100) : 0;

    // Manque à gagner (remises)
    kpis.missed_revenue = parseFloat(kpis.total_discounts);

    return kpis;
  }

  /**
   * Récupère l'évolution du CA par période (jour, semaine, mois)
   */
  async getRevenueEvolution(filters = {}, groupBy = 'day') {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = "TO_CHAR(date_created, 'YYYY-MM-DD HH24:00')";
        break;
      case 'day':
        dateFormat = "DATE(date_created)";
        break;
      case 'week':
        dateFormat = "DATE_TRUNC('week', date_created)";
        break;
      case 'month':
        dateFormat = "DATE_TRUNC('month', date_created)";
        break;
      case 'year':
        dateFormat = "DATE_TRUNC('year', date_created)";
        break;
      default:
        dateFormat = "DATE(date_created)";
    }

    const query = `
      SELECT
        ${dateFormat} as period,
        COUNT(DISTINCT order_id) as orders_count,
        COALESCE(SUM(total), 0) as revenue,
        COALESCE(AVG(total), 0) as avg_order_value
      FROM orders
      ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Top produits (par volume ou CA)
   */
  async getTopProducts(filters = {}, limit = 10, sortBy = 'revenue') {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const sortColumn = sortBy === 'quantity' ? 'total_quantity' : 'total_revenue';

    const query = `
      SELECT
        p.product_id,
        p.name,
        p.sku,
        p.image_url,
        p.category,
        p.price,
        COALESCE(p.cost_price_custom, p.cost_price) as cost_price,
        SUM(oi.quantity) as total_quantity,
        COALESCE(SUM(oi.total), 0) as total_revenue,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as total_cost,
        COUNT(DISTINCT oi.order_id) as orders_count
      FROM products p
      JOIN order_items oi ON oi.product_id = p.product_id
      JOIN orders o ON o.order_id = oi.order_id
      ${whereClause}
      GROUP BY p.product_id
      ORDER BY ${sortColumn} DESC
      LIMIT $${params.length + 1}
    `;

    const result = await pool.query(query, [...params, limit]);

    // Calcul de la marge pour chaque produit
    return result.rows.map(product => ({
      ...product,
      margin: parseFloat(product.total_revenue) - parseFloat(product.total_cost),
      margin_percent: parseFloat(product.total_revenue) > 0
        ? ((parseFloat(product.total_revenue) - parseFloat(product.total_cost)) / parseFloat(product.total_revenue) * 100)
        : 0
    }));
  }

  /**
   * Top clients (par CA)
   */
  async getTopCustomers(filters = {}, limit = 10) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        COUNT(DISTINCT o.order_id) as orders_count,
        COALESCE(SUM(o.total), 0) as total_spent,
        COALESCE(AVG(o.total), 0) as avg_order_value,
        MAX(o.date_created) as last_order_date
      FROM customers c
      JOIN orders o ON o.customer_id = c.customer_id
      ${whereClause}
      GROUP BY c.customer_id
      ORDER BY total_spent DESC
      LIMIT $${params.length + 1}
    `;

    const result = await pool.query(query, [...params, limit]);
    return result.rows;
  }

  /**
   * Stats par pays
   */
  async getStatsByCountry(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        o.shipping_country as country,
        COUNT(DISTINCT o.order_id) as orders_count,
        COALESCE(SUM(o.total), 0) as revenue,
        COALESCE(AVG(o.total), 0) as avg_order_value,
        COALESCE(SUM(o.shipping_total), 0) as shipping_charged,
        COALESCE(SUM(o.shipping_cost_real), 0) as shipping_real_cost
      FROM orders o
      ${whereClause}
      GROUP BY o.shipping_country
      ORDER BY revenue DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Stats par transporteur
   */
  async getStatsByShippingMethod(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        o.shipping_method,
        o.shipping_method_title,
        COUNT(DISTINCT o.order_id) as orders_count,
        COALESCE(SUM(o.total), 0) as revenue,
        COALESCE(SUM(o.shipping_total), 0) as shipping_charged,
        COALESCE(SUM(o.shipping_cost_real), 0) as shipping_real_cost,
        COALESCE(SUM(o.shipping_total - COALESCE(o.shipping_cost_real, o.shipping_total)), 0) as shipping_margin
      FROM orders o
      ${whereClause}
      GROUP BY o.shipping_method, o.shipping_method_title
      ORDER BY orders_count DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Stats par méthode de paiement
   */
  async getStatsByPaymentMethod(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        o.payment_method,
        o.payment_method_title,
        COUNT(DISTINCT o.order_id) as orders_count,
        COALESCE(SUM(o.total), 0) as revenue,
        COALESCE(AVG(o.total), 0) as avg_order_value
      FROM orders o
      ${whereClause}
      GROUP BY o.payment_method, o.payment_method_title
      ORDER BY revenue DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Stats par catégorie de produits
   */
  async getStatsByCategory(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        p.category,
        COUNT(DISTINCT p.product_id) as products_count,
        SUM(oi.quantity) as total_quantity_sold,
        COALESCE(SUM(oi.total), 0) as revenue,
        COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0) as total_cost
      FROM products p
      JOIN order_items oi ON oi.product_id = p.product_id
      JOIN orders o ON o.order_id = oi.order_id
      ${whereClause}
      GROUP BY p.category
      ORDER BY revenue DESC
    `;

    const result = await pool.query(query, params);

    return result.rows.map(cat => ({
      ...cat,
      margin: parseFloat(cat.revenue) - parseFloat(cat.total_cost),
      margin_percent: parseFloat(cat.revenue) > 0
        ? ((parseFloat(cat.revenue) - parseFloat(cat.total_cost)) / parseFloat(cat.revenue) * 100)
        : 0
    }));
  }

  /**
   * Top coupons utilisés
   */
  async getTopCoupons(filters = {}, limit = 10) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        oc.code,
        oc.discount_type,
        COUNT(DISTINCT oc.order_id) as usage_count,
        COALESCE(SUM(oc.discount), 0) as total_discount
      FROM order_coupons oc
      JOIN orders o ON o.order_id = oc.order_id
      ${whereClause}
      GROUP BY oc.code, oc.discount_type
      ORDER BY total_discount DESC
      LIMIT $${params.length + 1}
    `;

    const result = await pool.query(query, [...params, limit]);
    return result.rows;
  }

  /**
   * Stats par statut de commande
   */
  async getStatsByStatus(filters = {}) {
    const whereConditions = this._buildWhereConditions(filters);
    const { whereClause, params } = whereConditions;

    const query = `
      SELECT
        o.status,
        COUNT(DISTINCT o.order_id) as orders_count,
        COALESCE(SUM(o.total), 0) as revenue
      FROM orders o
      ${whereClause}
      GROUP BY o.status
      ORDER BY orders_count DESC
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Comparaison entre deux périodes
   */
  async getComparison(currentFilters = {}, previousFilters = {}) {
    const currentKPIs = await this.getDashboardKPIs(currentFilters);
    const previousKPIs = await this.getDashboardKPIs(previousFilters);

    return {
      current: currentKPIs,
      previous: previousKPIs,
      changes: {
        revenue: this._calculatePercentChange(currentKPIs.total_revenue, previousKPIs.total_revenue),
        orders: this._calculatePercentChange(currentKPIs.total_orders, previousKPIs.total_orders),
        avg_order_value: this._calculatePercentChange(currentKPIs.avg_order_value, previousKPIs.avg_order_value),
        customers: this._calculatePercentChange(currentKPIs.unique_customers, previousKPIs.unique_customers),
        margin: this._calculatePercentChange(currentKPIs.gross_margin, previousKPIs.gross_margin)
      }
    };
  }

  /**
   * Construit les conditions WHERE SQL en fonction des filtres
   * @private
   */
  _buildWhereConditions(filters) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Filtre par période
    if (filters.period) {
      const periodMatch = filters.period.match(/^(\d+)([hdwmy])$/);
      if (periodMatch) {
        const value = parseInt(periodMatch[1]);
        const unit = periodMatch[2];
        const unitMap = { h: 'hours', d: 'days', w: 'weeks', m: 'months', y: 'years' };
        conditions.push(`o.date_created >= NOW() - INTERVAL '${value} ${unitMap[unit]}'`);
      }
    }

    // Filtre par dates custom
    if (filters.startDate) {
      conditions.push(`o.date_created >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }
    if (filters.endDate) {
      conditions.push(`o.date_created <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }

    // Filtre par statut
    if (filters.status) {
      conditions.push(`o.status = $${paramIndex}`);
      params.push(filters.status);
      paramIndex++;
    }

    // Filtre par pays
    if (filters.country) {
      conditions.push(`o.shipping_country = $${paramIndex}`);
      params.push(filters.country);
      paramIndex++;
    }

    // Filtre par transporteur
    if (filters.shippingMethod) {
      conditions.push(`o.shipping_method = $${paramIndex}`);
      params.push(filters.shippingMethod);
      paramIndex++;
    }

    // Filtre par méthode de paiement
    if (filters.paymentMethod) {
      conditions.push(`o.payment_method = $${paramIndex}`);
      params.push(filters.paymentMethod);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    return { whereClause, params };
  }

  /**
   * Calcule le pourcentage de changement entre deux valeurs
   * @private
   */
  _calculatePercentChange(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }
}

module.exports = new StatsService();
