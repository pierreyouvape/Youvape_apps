const pool = require('../config/database');

class OrderModel {
  /**
   * Récupère toutes les commandes avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        o.*,
        c.first_name,
        c.last_name,
        c.email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count,
        (SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0)
         FROM order_items oi WHERE oi.order_id = o.order_id) as total_cost
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      ORDER BY o.date_created DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Compte le nombre total de commandes
   */
  async count() {
    const result = await pool.query('SELECT COUNT(*) as total FROM orders');
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère une commande par ID avec tous ses détails
   */
  async getById(orderId) {
    const client = await pool.connect();
    try {
      // Récupère la commande
      const orderQuery = `
        SELECT
          o.*,
          c.first_name,
          c.last_name,
          c.email,
          c.phone,
          (SELECT COALESCE(SUM(oi.quantity * COALESCE(oi.cost_price, 0)), 0)
           FROM order_items oi WHERE oi.order_id = o.order_id) as total_cost
        FROM orders o
        LEFT JOIN customers c ON c.customer_id = o.customer_id
        WHERE o.order_id = $1
      `;
      const orderResult = await client.query(orderQuery, [orderId]);

      if (orderResult.rows.length === 0) {
        return null;
      }

      const order = orderResult.rows[0];

      // Récupère les items de la commande
      const itemsQuery = `
        SELECT
          oi.*,
          p.name as product_name,
          p.image_url,
          p.category
        FROM order_items oi
        LEFT JOIN products p ON p.product_id = oi.product_id
        WHERE oi.order_id = $1
        ORDER BY oi.id
      `;
      const itemsResult = await client.query(itemsQuery, [orderId]);
      order.line_items = itemsResult.rows;

      // Récupère les coupons de la commande
      const couponsQuery = `
        SELECT * FROM order_coupons
        WHERE order_id = $1
        ORDER BY id
      `;
      const couponsResult = await client.query(couponsQuery, [orderId]);
      order.coupons = couponsResult.rows;

      return order;
    } finally {
      client.release();
    }
  }

  /**
   * Récupère les commandes d'un client
   */
  async getByCustomerId(customerId, limit = 50) {
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
   * Recherche de commandes (numéro, email client)
   */
  async search(searchTerm, limit = 50, offset = 0) {
    const query = `
      SELECT
        o.*,
        c.first_name,
        c.last_name,
        c.email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE
        o.order_number LIKE $1
        OR LOWER(c.email) LIKE $1
        OR LOWER(c.first_name || ' ' || c.last_name) LIKE $1
      ORDER BY o.date_created DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Filtre commandes par statut
   */
  async getByStatus(status, limit = 50, offset = 0) {
    const query = `
      SELECT
        o.*,
        c.first_name,
        c.last_name,
        c.email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE o.status = $1
      ORDER BY o.date_created DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [status, limit, offset]);
    return result.rows;
  }

  /**
   * Filtre commandes par pays
   */
  async getByCountry(country, limit = 50, offset = 0) {
    const query = `
      SELECT
        o.*,
        c.first_name,
        c.last_name,
        c.email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE o.shipping_country = $1
      ORDER BY o.date_created DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [country, limit, offset]);
    return result.rows;
  }

  /**
   * Filtre commandes par plage de dates
   */
  async getByDateRange(startDate, endDate, limit = 50, offset = 0) {
    const query = `
      SELECT
        o.*,
        c.first_name,
        c.last_name,
        c.email,
        (SELECT COUNT(*) FROM order_items WHERE order_id = o.order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE o.date_created BETWEEN $1 AND $2
      ORDER BY o.date_created DESC
      LIMIT $3 OFFSET $4
    `;
    const result = await pool.query(query, [startDate, endDate, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère tous les statuts de commandes existants
   */
  async getStatuses() {
    const query = `
      SELECT DISTINCT status
      FROM orders
      WHERE status IS NOT NULL
      ORDER BY status ASC
    `;
    const result = await pool.query(query);
    return result.rows.map(row => row.status);
  }

  /**
   * Récupère tous les pays de livraison existants
   */
  async getCountries() {
    const query = `
      SELECT DISTINCT shipping_country
      FROM orders
      WHERE shipping_country IS NOT NULL
      ORDER BY shipping_country ASC
    `;
    const result = await pool.query(query);
    return result.rows.map(row => row.shipping_country);
  }

  /**
   * Met à jour le coût réel de livraison d'une commande
   */
  async updateShippingCost(orderId, shippingCostReal) {
    const query = `
      UPDATE orders
      SET
        shipping_cost_real = $1,
        updated_at = NOW()
      WHERE order_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [shippingCostReal, orderId]);
    return result.rows[0];
  }

  /**
   * Récupère les items d'une commande
   */
  async getItems(orderId) {
    const query = `
      SELECT
        oi.*,
        p.name as product_name,
        p.image_url,
        p.category
      FROM order_items oi
      LEFT JOIN products p ON p.product_id = oi.product_id
      WHERE oi.order_id = $1
      ORDER BY oi.id
    `;
    const result = await pool.query(query, [orderId]);
    return result.rows;
  }

  /**
   * Récupère les coupons d'une commande
   */
  async getCoupons(orderId) {
    const query = `
      SELECT * FROM order_coupons
      WHERE order_id = $1
      ORDER BY id
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Crée une nouvelle commande (avec items et coupons)
   */
  async create(orderData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Insert order
      const orderQuery = `
        INSERT INTO orders (
          order_id, order_number, status, total, subtotal,
          shipping_total, shipping_cost_real, discount_total, tax_total,
          payment_method, payment_method_title, currency,
          date_created, date_completed, date_modified,
          customer_id, shipping_method, shipping_method_title, shipping_country,
          billing_address, shipping_address, customer_note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        RETURNING *
      `;
      const orderValues = [
        orderData.order_id,
        orderData.order_number,
        orderData.status || 'pending',
        orderData.total || 0,
        orderData.subtotal || 0,
        orderData.shipping_total || 0,
        orderData.shipping_cost_real || null,
        orderData.discount_total || 0,
        orderData.tax_total || 0,
        orderData.payment_method || null,
        orderData.payment_method_title || null,
        orderData.currency || 'EUR',
        orderData.date_created || null,
        orderData.date_completed || null,
        orderData.date_modified || null,
        orderData.customer_id || null,
        orderData.shipping_method || null,
        orderData.shipping_method_title || null,
        orderData.shipping_country || null,
        JSON.stringify(orderData.billing_address || {}),
        JSON.stringify(orderData.shipping_address || {}),
        orderData.customer_note || null
      ];
      const orderResult = await client.query(orderQuery, orderValues);
      const order = orderResult.rows[0];

      // Insert order items
      if (orderData.line_items && Array.isArray(orderData.line_items)) {
        for (const item of orderData.line_items) {
          const itemQuery = `
            INSERT INTO order_items (
              order_id, product_id, product_name, sku, quantity,
              price, regular_price, subtotal, total, discount, cost_price, tax
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `;
          const itemValues = [
            order.order_id,
            item.product_id || null,
            item.product_name || '',
            item.sku || null,
            item.quantity || 0,
            item.price || 0,
            item.regular_price || null,
            item.subtotal || 0,
            item.total || 0,
            item.discount || 0,
            item.cost_price || null,
            item.tax || 0
          ];
          await client.query(itemQuery, itemValues);
        }
      }

      // Insert coupons
      if (orderData.coupon_lines && Array.isArray(orderData.coupon_lines)) {
        for (const coupon of orderData.coupon_lines) {
          const couponQuery = `
            INSERT INTO order_coupons (order_id, code, discount, discount_type)
            VALUES ($1, $2, $3, $4)
          `;
          const couponValues = [
            order.order_id,
            coupon.code || '',
            coupon.discount || 0,
            coupon.discount_type || null
          ];
          await client.query(couponQuery, couponValues);
        }
      }

      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Met à jour une commande
   */
  async update(orderId, orderData) {
    const query = `
      UPDATE orders
      SET
        status = $1,
        total = $2,
        subtotal = $3,
        shipping_total = $4,
        shipping_cost_real = $5,
        discount_total = $6,
        tax_total = $7,
        date_completed = $8,
        updated_at = NOW()
      WHERE order_id = $9
      RETURNING *
    `;
    const values = [
      orderData.status,
      orderData.total,
      orderData.subtotal,
      orderData.shipping_total,
      orderData.shipping_cost_real || null,
      orderData.discount_total,
      orderData.tax_total,
      orderData.date_completed || null,
      orderId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Supprime une commande (cascade sur items et coupons)
   */
  async delete(orderId) {
    const query = 'DELETE FROM orders WHERE order_id = $1 RETURNING *';
    const result = await pool.query(query, [orderId]);
    return result.rows[0];
  }
}

module.exports = new OrderModel();
