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
      JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
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
        COUNT(DISTINCT oi.wp_product_id)::int as unique_products_bought
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

  /**
   * Récupère tous les clients pour l'onglet Stats avec pagination
   * Exclut les commandes failed, cancelled, refunded
   */
  async getAllForStats(limit = 50, offset = 0, searchTerm = '', countryFilter = '') {
    let whereClause = '';
    let params = [];
    let paramIndex = 1;

    // Ajout du filtre de recherche
    if (searchTerm) {
      whereClause += ` WHERE LOWER(c.first_name || ' ' || c.last_name || ' ' || c.email) LIKE $${paramIndex}`;
      params.push(`%${searchTerm.toLowerCase()}%`);
      paramIndex++;
    }

    // Ajout du filtre pays
    if (countryFilter) {
      whereClause += searchTerm ? ' AND' : ' WHERE';
      whereClause += ` EXISTS (
        SELECT 1 FROM orders o
        WHERE o.wp_customer_id = c.wp_user_id
        AND o.billing_country = $${paramIndex}
      )`;
      params.push(countryFilter);
      paramIndex++;
    }

    // Ajout limit et offset à la fin
    const limitParam = paramIndex;
    const offsetParam = paramIndex + 1;
    params.push(limit, offset);

    const query = `
      SELECT
        c.wp_user_id as id,
        c.first_name,
        c.last_name,
        c.email,
        (
          SELECT COUNT(*)
          FROM orders
          WHERE wp_customer_id = c.wp_user_id
          AND post_status NOT IN ('wc-failed', 'wc-cancelled', 'wc-refunded')
        ) as order_count,
        (
          SELECT COALESCE(SUM(order_total), 0)
          FROM orders
          WHERE wp_customer_id = c.wp_user_id
          AND post_status NOT IN ('wc-failed', 'wc-cancelled', 'wc-refunded')
        ) as total_spent,
        (
          SELECT billing_country
          FROM orders
          WHERE wp_customer_id = c.wp_user_id
          ORDER BY post_date DESC
          LIMIT 1
        ) as country
      FROM customers c
      ${whereClause}
      ORDER BY total_spent DESC
      LIMIT $${limitParam} OFFSET $${offsetParam}
    `;

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Compte le nombre total de clients pour l'onglet Stats avec filtres
   */
  async countForStats(searchTerm = '', countryFilter = '') {
    let whereClause = '';
    let params = [];
    let paramIndex = 1;

    // Ajout du filtre de recherche
    if (searchTerm) {
      whereClause += ` WHERE LOWER(c.first_name || ' ' || c.last_name || ' ' || c.email) LIKE $${paramIndex}`;
      params.push(`%${searchTerm.toLowerCase()}%`);
      paramIndex++;
    }

    // Ajout du filtre pays
    if (countryFilter) {
      whereClause += searchTerm ? ' AND' : ' WHERE';
      whereClause += ` EXISTS (
        SELECT 1 FROM orders o
        WHERE o.wp_customer_id = c.wp_user_id
        AND o.billing_country = $${paramIndex}
      )`;
      params.push(countryFilter);
      paramIndex++;
    }

    const query = `SELECT COUNT(*) as total FROM customers c ${whereClause}`;
    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère la liste des pays uniques des clients
   */
  async getCountries() {
    const query = `
      SELECT DISTINCT billing_country as country
      FROM orders
      WHERE billing_country IS NOT NULL AND billing_country != ''
      ORDER BY billing_country
    `;
    const result = await pool.query(query);
    return result.rows.map(row => row.country);
  }

  /**
   * Récupère les infos détaillées d'un client pour la page détail
   */
  async getDetailById(wpUserId) {
    const query = `
      SELECT
        c.*,
        (
          SELECT json_build_object(
            'first_name', o.billing_first_name,
            'last_name', o.billing_last_name,
            'address_1', o.billing_address_1,
            'address_2', o.billing_address_2,
            'city', o.billing_city,
            'postcode', o.billing_postcode,
            'country', o.billing_country,
            'phone', o.billing_phone
          )
          FROM orders o
          WHERE o.wp_customer_id = c.wp_user_id
          ORDER BY o.post_date DESC
          LIMIT 1
        ) as billing_address,
        (
          SELECT json_build_object(
            'first_name', o.shipping_first_name,
            'last_name', o.shipping_last_name,
            'address_1', o.shipping_address_1,
            'city', o.shipping_city,
            'postcode', o.shipping_postcode,
            'country', o.shipping_country,
            'phone', o.shipping_phone
          )
          FROM orders o
          WHERE o.wp_customer_id = c.wp_user_id
          ORDER BY o.post_date DESC
          LIMIT 1
        ) as shipping_address
      FROM customers c
      WHERE c.wp_user_id = $1
    `;
    const result = await pool.query(query, [wpUserId]);
    return result.rows[0];
  }

  /**
   * Récupère les stats pour la page détail client
   * - Nombre commandes: exclut failed/cancelled
   * - Total dépensé: exclut failed/cancelled/refunded
   */
  async getStatsForDetail(wpUserId, customerEmail) {
    // Nombre de commandes (exclut failed et cancelled uniquement)
    const orderCountQuery = `
      SELECT COUNT(*)::int as order_count
      FROM orders
      WHERE wp_customer_id = $1
      AND post_status NOT IN ('wc-failed', 'wc-cancelled')
    `;
    const orderCountResult = await pool.query(orderCountQuery, [wpUserId]);
    const orderCount = parseInt(orderCountResult.rows[0]?.order_count || 0);

    // Total dépensé et commande moyenne (exclut failed, cancelled ET refunded)
    const spentQuery = `
      SELECT
        COALESCE(SUM(order_total), 0) as total_spent,
        COALESCE(AVG(order_total), 0) as avg_order
      FROM orders
      WHERE wp_customer_id = $1
      AND post_status NOT IN ('wc-failed', 'wc-cancelled', 'wc-refunded')
    `;
    const spentResult = await pool.query(spentQuery, [wpUserId]);
    const totalSpent = parseFloat(spentResult.rows[0]?.total_spent || 0);
    const avgOrder = parseFloat(spentResult.rows[0]?.avg_order || 0);

    // Nombre de produits différents achetés
    const uniqueProductsQuery = `
      SELECT COUNT(DISTINCT oi.wp_product_id)::int as unique_products
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.wp_customer_id = $1
      AND o.post_status NOT IN ('wc-failed', 'wc-cancelled')
    `;
    const uniqueProductsResult = await pool.query(uniqueProductsQuery, [wpUserId]);
    const uniqueProducts = parseInt(uniqueProductsResult.rows[0]?.unique_products || 0);

    // Coût total (exclut failed, cancelled, refunded)
    const costQuery = `
      SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as total_cost
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.wp_customer_id = $1
      AND o.post_status NOT IN ('wc-failed', 'wc-cancelled', 'wc-refunded')
    `;
    const costResult = await pool.query(costQuery, [wpUserId]);
    const totalCost = parseFloat(costResult.rows[0]?.total_cost || 0);

    // Calcul bénéfice et marge
    const profit = totalSpent - totalCost;
    const margin = totalSpent > 0 ? ((profit / totalSpent) * 100) : 0;

    // Nombre d'avis laissés (via email client)
    const reviewsQuery = `
      SELECT COUNT(*)::int as reviews_count
      FROM reviews
      WHERE customer_email = $1
    `;
    const reviewsResult = await pool.query(reviewsQuery, [customerEmail]);
    const reviewsCount = parseInt(reviewsResult.rows[0]?.reviews_count || 0);

    return {
      order_count: orderCount,
      total_spent: totalSpent,
      avg_order: avgOrder,
      unique_products: uniqueProducts,
      total_cost: totalCost,
      profit: profit,
      margin: margin,
      reviews_count: reviewsCount
    };
  }

  /**
   * Récupère les commandes d'un client avec indicateur avis
   */
  async getOrdersWithReviews(wpUserId) {
    const query = `
      SELECT
        o.wp_order_id,
        o.post_date,
        o.post_status,
        o.order_total,
        o.payment_method_title,
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count,
        (SELECT COUNT(*) > 0 FROM reviews WHERE order_id = o.wp_order_id::text) as has_review
      FROM orders o
      WHERE o.wp_customer_id = $1
      ORDER BY o.post_date DESC
    `;
    const result = await pool.query(query, [wpUserId]);
    return result.rows;
  }

  /**
   * Récupère les détails d'une commande (items + shipping)
   */
  async getOrderDetails(wpOrderId) {
    // Items de la commande
    const itemsQuery = `
      SELECT
        oi.*,
        p.post_title as product_name,
        p.sku
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = oi.wp_product_id
      WHERE oi.wp_order_id = $1
      AND oi.order_item_type = 'line_item'
    `;
    const itemsResult = await pool.query(itemsQuery, [wpOrderId]);

    // Infos de la commande (shipping method)
    const orderQuery = `
      SELECT
        payment_method_title,
        order_shipping,
        shipping_company,
        shipping_first_name,
        shipping_last_name,
        shipping_address_1,
        shipping_city,
        shipping_postcode,
        shipping_country
      FROM orders
      WHERE wp_order_id = $1
    `;
    const orderResult = await pool.query(orderQuery, [wpOrderId]);

    // Méthode d'expédition (depuis order_items type shipping)
    const shippingQuery = `
      SELECT order_item_name
      FROM order_items
      WHERE wp_order_id = $1 AND order_item_type = 'shipping'
      LIMIT 1
    `;
    const shippingResult = await pool.query(shippingQuery, [wpOrderId]);

    return {
      items: itemsResult.rows,
      order: orderResult.rows[0],
      shipping_method: shippingResult.rows[0]?.order_item_name || null
    };
  }
}

module.exports = new CustomerModel();
