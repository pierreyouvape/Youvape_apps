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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count,
        (SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0)
         FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id) as total_cost
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      ORDER BY o.post_date DESC
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
          (SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0)
           FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id) as total_cost
        FROM orders o
        LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
        WHERE o.wp_order_id = $1
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
          p.post_title as product_name
        FROM order_items oi
        LEFT JOIN products p ON p.wp_product_id = oi.product_id
        WHERE oi.wp_order_id = $1
        ORDER BY oi.id
      `;
      const itemsResult = await client.query(itemsQuery, [orderId]);
      order.line_items = itemsResult.rows;

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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      WHERE o.wp_customer_id = $1
      ORDER BY o.post_date DESC
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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE
        CAST(o.wp_order_id AS TEXT) LIKE $1
        OR LOWER(c.email) LIKE $1
        OR LOWER(c.first_name || ' ' || c.last_name) LIKE $1
      ORDER BY o.post_date DESC
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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE o.post_status = $1
      ORDER BY o.post_date DESC
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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE o.shipping_country = $1
      ORDER BY o.post_date DESC
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
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE o.post_date BETWEEN $1 AND $2
      ORDER BY o.post_date DESC
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
      SELECT DISTINCT post_status
      FROM orders
      WHERE post_status IS NOT NULL
      ORDER BY post_status ASC
    `;
    const result = await pool.query(query);
    return result.rows.map(row => row.post_status);
  }

  /**
   * Récupère tous les pays de livraison existants
   */
  async getCountries() {
    const query = `
      SELECT DISTINCT billing_country as country, COUNT(*) as count
      FROM orders
      WHERE billing_country IS NOT NULL AND billing_country != ''
      GROUP BY billing_country
      ORDER BY count DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Récupère tous les transporteurs existants
   */
  async getShippingMethods() {
    const query = `
      SELECT DISTINCT order_item_name as shipping_method, COUNT(*) as count
      FROM order_items
      WHERE order_item_type = 'shipping' AND order_item_name IS NOT NULL
      GROUP BY order_item_name
      ORDER BY count DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Recherche avancée avec tous les filtres
   */
  async advancedSearch(filters) {
    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Recherche texte (numéro commande, nom, prénom, email)
    if (filters.search) {
      conditions.push(`(
        CAST(o.wp_order_id AS TEXT) ILIKE $${paramIndex}
        OR o.billing_first_name ILIKE $${paramIndex}
        OR o.billing_last_name ILIKE $${paramIndex}
        OR o.billing_email ILIKE $${paramIndex}
        OR CONCAT(o.billing_first_name, ' ', o.billing_last_name) ILIKE $${paramIndex}
      )`);
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    // Filtre par pays
    if (filters.country) {
      conditions.push(`o.billing_country = $${paramIndex}`);
      params.push(filters.country);
      paramIndex++;
    }

    // Filtre par statut (peut être un tableau)
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        conditions.push(`o.post_status = ANY($${paramIndex})`);
        params.push(filters.status);
      } else {
        conditions.push(`o.post_status = $${paramIndex}`);
        params.push(filters.status);
      }
      paramIndex++;
    }

    // Filtre par montant minimum
    if (filters.minAmount !== undefined && filters.minAmount !== '') {
      conditions.push(`o.order_total >= $${paramIndex}`);
      params.push(parseFloat(filters.minAmount));
      paramIndex++;
    }

    // Filtre par montant maximum
    if (filters.maxAmount !== undefined && filters.maxAmount !== '') {
      conditions.push(`o.order_total <= $${paramIndex}`);
      params.push(parseFloat(filters.maxAmount));
      paramIndex++;
    }

    // Filtre par date de début
    if (filters.dateFrom) {
      conditions.push(`o.post_date >= $${paramIndex}`);
      params.push(filters.dateFrom);
      paramIndex++;
    }

    // Filtre par date de fin
    if (filters.dateTo) {
      conditions.push(`o.post_date <= $${paramIndex}::date + interval '1 day'`);
      params.push(filters.dateTo);
      paramIndex++;
    }

    // Filtre par transporteur
    if (filters.shippingMethod) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_ship
        WHERE oi_ship.wp_order_id = o.wp_order_id
        AND oi_ship.order_item_type = 'shipping'
        AND oi_ship.order_item_name = $${paramIndex}
      )`);
      params.push(filters.shippingMethod);
      paramIndex++;
    }

    // Filtre par catégorie de produit
    if (filters.category) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_cat
        JOIN products p_cat ON (p_cat.wp_product_id = oi_cat.product_id OR p_cat.wp_product_id = oi_cat.variation_id)
        WHERE oi_cat.wp_order_id = o.wp_order_id
        AND oi_cat.order_item_type = 'line_item'
        AND (p_cat.category = $${paramIndex} OR p_cat.sub_category = $${paramIndex})
      )`);
      params.push(filters.category);
      paramIndex++;
    }

    // Filtre par produit spécifique
    if (filters.productId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_prod
        WHERE oi_prod.wp_order_id = o.wp_order_id
        AND oi_prod.order_item_type = 'line_item'
        AND (oi_prod.product_id = $${paramIndex} OR oi_prod.variation_id = $${paramIndex})
      )`);
      params.push(parseInt(filters.productId));
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const limit = parseInt(filters.limit) || 100;
    const offset = parseInt(filters.offset) || 0;

    // Compter le total
    const countQuery = `
      SELECT COUNT(DISTINCT o.wp_order_id) as total
      FROM orders o
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Récupérer les commandes
    const query = `
      SELECT DISTINCT
        o.wp_order_id,
        o.post_date,
        o.post_status,
        o.billing_first_name,
        o.billing_last_name,
        o.billing_email,
        o.billing_phone,
        o.billing_country,
        o.billing_address_1,
        o.billing_city,
        o.billing_postcode,
        o.shipping_first_name,
        o.shipping_last_name,
        o.shipping_country,
        o.shipping_address_1,
        o.shipping_city,
        o.shipping_postcode,
        o.order_total,
        o.order_shipping,
        o.payment_method_title,
        (SELECT oi_s.order_item_name FROM order_items oi_s WHERE oi_s.wp_order_id = o.wp_order_id AND oi_s.order_item_type = 'shipping' LIMIT 1) as shipping_method,
        (SELECT COUNT(*) FROM order_items oi_c WHERE oi_c.wp_order_id = o.wp_order_id AND oi_c.order_item_type = 'line_item') as items_count
      FROM orders o
      ${whereClause}
      ORDER BY o.post_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return {
      orders: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    };
  }

  /**
   * Récupère les détails complets d'une commande pour l'affichage dépliable
   */
  async getOrderDetails(orderId) {
    // Récupérer les items produits
    const itemsQuery = `
      SELECT
        oi.order_item_name,
        oi.product_id,
        oi.variation_id,
        oi.qty,
        oi.line_total,
        oi.line_subtotal,
        oi.item_cost,
        p.post_title as product_title,
        p.sku,
        p.image_url,
        p.brand,
        p.category
      FROM order_items oi
      LEFT JOIN products p ON (p.wp_product_id = oi.product_id OR p.wp_product_id = oi.variation_id)
      WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
      ORDER BY oi.id
    `;
    const itemsResult = await pool.query(itemsQuery, [orderId]);

    return {
      items: itemsResult.rows
    };
  }

  /**
   * Récupère les statistiques par statut
   */
  async getStatsByStatus() {
    const query = `
      SELECT
        post_status as status,
        COUNT(*) as count,
        COALESCE(SUM(order_total), 0) as total_amount
      FROM orders
      GROUP BY post_status
      ORDER BY count DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  /**
   * Met à jour le coût réel de livraison d'une commande
   */
  async updateShippingCost(orderId, shippingCostReal) {
    const query = `
      UPDATE orders
      SET
        order_shipping = $1,
        updated_at = NOW()
      WHERE wp_order_id = $2
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
        p.post_title as product_name
      FROM order_items oi
      LEFT JOIN products p ON p.wp_product_id = oi.product_id
      WHERE oi.wp_order_id = $1
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
      WHERE wp_order_id = $1
      ORDER BY id
    `;
    const result = await pool.query(query, [orderId]);
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
