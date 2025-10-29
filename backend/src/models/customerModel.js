const pool = require('../config/database');

class CustomerModel {
  /**
   * Récupère tous les clients avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.customer_id) as actual_order_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE customer_id = c.customer_id AND status = 'completed') as actual_total_spent,
        (SELECT MAX(date_created) FROM orders WHERE customer_id = c.customer_id) as last_order_date
      FROM customers c
      ORDER BY actual_total_spent DESC
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
  async getById(customerId) {
    const query = `
      SELECT
        c.*,
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.customer_id) as actual_order_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE customer_id = c.customer_id AND status = 'completed') as actual_total_spent,
        (SELECT MAX(date_created) FROM orders WHERE customer_id = c.customer_id) as last_order_date,
        (SELECT MIN(date_created) FROM orders WHERE customer_id = c.customer_id) as first_order_date
      FROM customers c
      WHERE c.customer_id = $1
    `;
    const result = await pool.query(query, [customerId]);
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
        (SELECT COUNT(*) FROM orders WHERE customer_id = c.customer_id) as actual_order_count,
        (SELECT COALESCE(SUM(total), 0) FROM orders WHERE customer_id = c.customer_id AND status = 'completed') as actual_total_spent
      FROM customers c
      WHERE
        LOWER(c.first_name || ' ' || c.last_name || ' ' || c.email) LIKE $1
      ORDER BY actual_total_spent DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère l'historique des commandes d'un client
   */
  async getOrders(customerId, limit = 50) {
    const query = `
      SELECT
        o.*,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
      FROM orders o
      WHERE o.customer_id = $1
      ORDER BY o.date_created DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [customerId, limit]);
    return result.rows;
  }

  /**
   * Récupère les produits favoris d'un client (top produits achetés)
   */
  async getFavoriteProducts(customerId, limit = 10) {
    const query = `
      SELECT
        p.product_id,
        p.name,
        p.sku,
        p.image_url,
        p.price,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.total) as total_spent,
        COUNT(DISTINCT oi.order_id) as order_count
      FROM products p
      JOIN order_items oi ON oi.product_id = p.product_id
      JOIN orders o ON o.order_id = oi.order_id
      WHERE o.customer_id = $1
      GROUP BY p.product_id
      ORDER BY total_quantity DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [customerId, limit]);
    return result.rows;
  }

  /**
   * Récupère les statistiques avancées d'un client
   */
  async getStats(customerId) {
    const query = `
      WITH order_dates AS (
        SELECT
          date_created,
          LAG(date_created) OVER (ORDER BY date_created) as prev_order_date
        FROM orders
        WHERE customer_id = $1 AND status = 'completed'
      ),
      order_stats AS (
        SELECT
          COUNT(DISTINCT o.order_id) as total_orders,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total ELSE 0 END), 0) as total_spent,
          COALESCE(AVG(CASE WHEN o.status = 'completed' THEN o.total ELSE NULL END), 0) as avg_order_value,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_cost ELSE 0 END), 0) as total_cost,
          COALESCE(SUM(CASE WHEN o.status = 'completed' THEN COALESCE(o.shipping_cost_real, o.shipping_total, 0) ELSE 0 END), 0) as total_shipping_cost,
          MIN(o.date_created) as first_order_date,
          MAX(o.date_created) as last_order_date,
          COUNT(DISTINCT oi.product_id) as unique_products_bought
        FROM orders o
        LEFT JOIN order_items oi ON oi.order_id = o.order_id
        WHERE o.customer_id = $1
      )
      SELECT
        os.*,
        COALESCE(AVG(EXTRACT(EPOCH FROM (od.date_created - od.prev_order_date)) / 86400), 0) as avg_days_between_orders,
        (os.total_spent - os.total_cost - os.total_shipping_cost) as total_profit,
        CASE
          WHEN os.total_spent > 0 THEN ((os.total_spent - os.total_cost - os.total_shipping_cost) / os.total_spent * 100)
          ELSE 0
        END as margin_percent
      FROM order_stats os
      CROSS JOIN order_dates od
      GROUP BY os.total_orders, os.total_spent, os.avg_order_value, os.total_cost, os.total_shipping_cost,
               os.first_order_date, os.last_order_date, os.unique_products_bought
    `;
    const result = await pool.query(query, [customerId]);
    return result.rows[0];
  }

  /**
   * Récupère les coupons utilisés par un client
   */
  async getCoupons(customerId) {
    const query = `
      SELECT
        oc.code,
        COUNT(*) as usage_count,
        SUM(oc.discount) as total_discount
      FROM order_coupons oc
      JOIN orders o ON o.order_id = oc.order_id
      WHERE o.customer_id = $1
      GROUP BY oc.code
      ORDER BY usage_count DESC
    `;
    const result = await pool.query(query, [customerId]);
    return result.rows;
  }

  /**
   * Crée un nouveau client
   */
  async create(customerData) {
    const query = `
      INSERT INTO customers (
        customer_id, email, first_name, last_name, phone, username,
        date_created, total_spent, order_count,
        billing_address, shipping_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      customerData.customer_id,
      customerData.email,
      customerData.first_name || null,
      customerData.last_name || null,
      customerData.phone || null,
      customerData.username || null,
      customerData.date_created || null,
      customerData.total_spent || 0,
      customerData.order_count || 0,
      JSON.stringify(customerData.billing_address || {}),
      JSON.stringify(customerData.shipping_address || {})
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Met à jour un client
   */
  async update(customerId, customerData) {
    const query = `
      UPDATE customers
      SET
        email = $1,
        first_name = $2,
        last_name = $3,
        phone = $4,
        username = $5,
        total_spent = $6,
        order_count = $7,
        billing_address = $8,
        shipping_address = $9,
        updated_at = NOW()
      WHERE customer_id = $10
      RETURNING *
    `;
    const values = [
      customerData.email,
      customerData.first_name || null,
      customerData.last_name || null,
      customerData.phone || null,
      customerData.username || null,
      customerData.total_spent || 0,
      customerData.order_count || 0,
      JSON.stringify(customerData.billing_address || {}),
      JSON.stringify(customerData.shipping_address || {}),
      customerId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Supprime un client
   */
  async delete(customerId) {
    const query = 'DELETE FROM customers WHERE customer_id = $1 RETURNING *';
    const result = await pool.query(query, [customerId]);
    return result.rows[0];
  }
}

module.exports = new CustomerModel();
