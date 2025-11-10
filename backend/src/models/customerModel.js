const pool = require('../config/database');

class CustomerModel {
  /**
   * Récupère tous les clients avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id) as order_count,
        (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as total_spent,
        (SELECT MAX(post_date) FROM orders WHERE wp_customer_id = c.wp_user_id) as last_order_date
      FROM customers c
      ORDER BY total_spent DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Compte le nombre total de clients
   */
  async count() {
    const result = await pool.query('SELECT COUNT(*) as total FROM customers');
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère un client par ID
   */
  async getById(wpUserId) {
    const query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id) as order_count,
        (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as total_spent,
        (SELECT MAX(post_date) FROM orders WHERE wp_customer_id = c.wp_user_id) as last_order_date,
        (SELECT MIN(post_date) FROM orders WHERE wp_customer_id = c.wp_user_id) as first_order_date
      FROM customers c
      WHERE c.wp_user_id = $1
    `;
    const result = await pool.query(query, [wpUserId]);
    return result.rows[0];
  }

  /**
   * Récupère un client par email
   */
  async getByEmail(email) {
    const query = 'SELECT * FROM customers WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  /**
   * Recherche de clients (nom, prénom, email)
   */
  async search(searchTerm, limit = 50, offset = 0) {
    const query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id) as order_count,
        (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as total_spent
      FROM customers c
      WHERE
        LOWER(c.first_name || ' ' || c.last_name || ' ' || c.email) LIKE $1
      ORDER BY total_spent DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère l'historique des commandes d'un client
   */
  async getOrders(wpUserId, limit = 50) {
    const query = `
      SELECT
        o.*,
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      WHERE o.wp_customer_id = $1
      ORDER BY o.post_date DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpUserId, limit]);
    return result.rows;
  }

  /**
   * Récupère les produits favoris d'un client (top produits achetés)
   */
  async getFavoriteProducts(wpUserId, limit = 10) {
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title as name,
        p.sku,
        p.regular_price as price,
        SUM(oi.qty) as total_quantity,
        SUM(oi.line_total) as total_spent,
        COUNT(DISTINCT oi.wp_order_id) as order_count
      FROM products p
      JOIN order_items oi ON oi.product_id = p.wp_product_id
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.wp_customer_id = $1 AND o.post_status = 'wc-completed'
      GROUP BY p.wp_product_id, p.post_title, p.sku, p.regular_price
      ORDER BY total_quantity DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpUserId, limit]);
    return result.rows;
  }

  /**
   * Récupère les statistiques avancées d'un client
   */
  async getStats(wpUserId) {
    const query = `
      SELECT
        COUNT(DISTINCT o.wp_order_id)::int as total_orders,
        COALESCE(SUM(CASE WHEN o.post_status = 'wc-completed' THEN o.order_total ELSE 0 END), 0) as total_spent,
        COALESCE(AVG(CASE WHEN o.post_status = 'wc-completed' THEN o.order_total ELSE NULL END), 0) as avg_order_value,
        COALESCE(SUM(CASE WHEN o.post_status = 'wc-completed' THEN o.order_shipping ELSE 0 END), 0) as total_shipping_cost,
        MIN(o.post_date) as first_order_date,
        MAX(o.post_date) as last_order_date,
        COUNT(DISTINCT oi.product_id)::int as unique_products_bought
      FROM customers c
      LEFT JOIN orders o ON o.wp_customer_id = c.wp_user_id
      LEFT JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
      WHERE c.wp_user_id = $1
    `;

    const result = await pool.query(query, [wpUserId]);
    const stats = result.rows[0];

    // Calcul du coût total des produits achetés
    const costQuery = `
      SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as total_cost
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.wp_customer_id = $1 AND o.post_status = 'wc-completed'
    `;

    const costResult = await pool.query(costQuery, [wpUserId]);
    stats.total_cost = parseFloat(costResult.rows[0]?.total_cost || 0);

    // Calcul du délai moyen entre commandes
    const avgDaysQuery = `
      WITH order_dates AS (
        SELECT
          post_date,
          LAG(post_date) OVER (ORDER BY post_date) as prev_order_date
        FROM orders
        WHERE wp_customer_id = $1 AND post_status = 'wc-completed'
        ORDER BY post_date
      )
      SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (post_date - prev_order_date)) / 86400), 0) as avg_days
      FROM order_dates
      WHERE prev_order_date IS NOT NULL
    `;

    const avgDaysResult = await pool.query(avgDaysQuery, [wpUserId]);
    stats.avg_days_between_orders = parseFloat(avgDaysResult.rows[0]?.avg_days || 0);

    // Calcul profit et marge
    const totalSpent = parseFloat(stats.total_spent) || 0;
    const totalCost = parseFloat(stats.total_cost) || 0;
    const totalShippingCost = parseFloat(stats.total_shipping_cost) || 0;

    stats.total_profit = totalSpent - totalCost - totalShippingCost;
    stats.margin_percent = totalSpent > 0 ? ((stats.total_profit / totalSpent) * 100) : 0;

    return stats;
  }

  /**
   * Crée un nouveau client
   */
  async create(customerData) {
    const query = `
      INSERT INTO customers (
        wp_user_id, email, first_name, last_name, user_registered,
        session_start_time, session_pages, session_count, device_type, date_of_birth
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;
    const values = [
      customerData.wp_user_id,
      customerData.email,
      customerData.first_name || null,
      customerData.last_name || null,
      customerData.user_registered || null,
      customerData.session_start_time || null,
      customerData.session_pages || null,
      customerData.session_count || null,
      customerData.device_type || null,
      customerData.date_of_birth || null
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Met à jour un client
   */
  async update(wpUserId, customerData) {
    const query = `
      UPDATE customers
      SET
        email = $1,
        first_name = $2,
        last_name = $3,
        session_start_time = $4,
        session_pages = $5,
        session_count = $6,
        device_type = $7,
        date_of_birth = $8,
        updated_at = NOW()
      WHERE wp_user_id = $9
      RETURNING *
    `;
    const values = [
      customerData.email,
      customerData.first_name || null,
      customerData.last_name || null,
      customerData.session_start_time || null,
      customerData.session_pages || null,
      customerData.session_count || null,
      customerData.device_type || null,
      customerData.date_of_birth || null,
      wpUserId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Supprime un client
   */
  async delete(wpUserId) {
    const query = 'DELETE FROM customers WHERE wp_user_id = $1 RETURNING *';
    const result = await pool.query(query, [wpUserId]);
    return result.rows[0];
  }
}

module.exports = new CustomerModel();
