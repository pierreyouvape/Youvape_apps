const pool = require('../config/database');

class AdvancedFilterService {
  /**
   * Recherche avancée de clients avec filtres multiples
   * @param {Object} filters - {
   *   products: { operator: 'AND'|'OR', product_ids: [123, 456] },
   *   exclude: { product_ids: [789] },
   *   search: 'john',
   *   date_range: { from: '2024-01-01', to: '2024-12-31' },
   *   total_spent: { min: 100, max: 1000 },
   *   order_count: { min: 5 }
   * }
   */
  async searchCustomers(filters = {}) {
    let query = `
      SELECT DISTINCT c.*,
        (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as order_count,
        (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as total_spent,
        (SELECT MAX(post_date) FROM orders WHERE wp_customer_id = c.wp_user_id) as last_order_date
      FROM customers c
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Filtre : Produits achetés (AND) - Client a acheté TOUS les produits listés
    if (filters.products && filters.products.operator === 'AND' && filters.products.product_ids?.length > 0) {
      for (const productId of filters.products.product_ids) {
        query += `
          AND EXISTS (
            SELECT 1 FROM orders o
            JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
            WHERE o.wp_customer_id = c.wp_user_id
              AND oi.product_id = $${paramIndex}
              AND o.post_status = 'wc-completed'
          )
        `;
        params.push(productId);
        paramIndex++;
      }
    }

    // Filtre : Produits achetés (OR) - Client a acheté AU MOINS UN des produits
    if (filters.products && filters.products.operator === 'OR' && filters.products.product_ids?.length > 0) {
      query += `
        AND EXISTS (
          SELECT 1 FROM orders o
          JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
          WHERE o.wp_customer_id = c.wp_user_id
            AND oi.product_id = ANY($${paramIndex}::bigint[])
            AND o.post_status = 'wc-completed'
        )
      `;
      params.push(filters.products.product_ids);
      paramIndex++;
    }

    // Filtre : Exclusion de produits - Client N'A PAS acheté ces produits
    if (filters.exclude && filters.exclude.product_ids?.length > 0) {
      for (const productId of filters.exclude.product_ids) {
        query += `
          AND NOT EXISTS (
            SELECT 1 FROM orders o
            JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
            WHERE o.wp_customer_id = c.wp_user_id
              AND oi.product_id = $${paramIndex}
          )
        `;
        params.push(productId);
        paramIndex++;
      }
    }

    // Filtre : Plage de dates (inscription client)
    if (filters.date_range) {
      if (filters.date_range.from) {
        query += ` AND c.user_registered >= $${paramIndex}`;
        params.push(filters.date_range.from);
        paramIndex++;
      }
      if (filters.date_range.to) {
        query += ` AND c.user_registered <= $${paramIndex}`;
        params.push(filters.date_range.to);
        paramIndex++;
      }
    }

    // Filtre : Total dépensé
    if (filters.total_spent) {
      if (filters.total_spent.min) {
        query += `
          AND (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') >= $${paramIndex}
        `;
        params.push(filters.total_spent.min);
        paramIndex++;
      }
      if (filters.total_spent.max) {
        query += `
          AND (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') <= $${paramIndex}
        `;
        params.push(filters.total_spent.max);
        paramIndex++;
      }
    }

    // Filtre : Nombre de commandes
    if (filters.order_count) {
      if (filters.order_count.min) {
        query += `
          AND (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') >= $${paramIndex}
        `;
        params.push(filters.order_count.min);
        paramIndex++;
      }
      if (filters.order_count.max) {
        query += `
          AND (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') <= $${paramIndex}
        `;
        params.push(filters.order_count.max);
        paramIndex++;
      }
    }

    // Recherche texte (nom, email)
    if (filters.search) {
      query += `
        AND (
          LOWER(c.first_name || ' ' || c.last_name || ' ' || COALESCE(c.email, ''))
          LIKE $${paramIndex}
        )
      `;
      params.push(`%${filters.search.toLowerCase()}%`);
      paramIndex++;
    }

    // Pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    query += ` ORDER BY total_spent DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Recherche avancée de commandes avec filtres multiples
   * @param {Object} filters - {
   *   products: { operator: 'AND'|'OR', product_ids: [123, 456] },
   *   exclude: { product_ids: [789] },
   *   status: 'completed',
   *   country: 'FR',
   *   shipping_method: 'colissimo',
   *   total: { min: 50, max: 500 },
   *   date_range: { from: '2024-01-01', to: '2024-12-31' }
   * }
   */
  async searchOrders(filters = {}) {
    let query = `
      SELECT o.*,
        c.first_name, c.last_name, c.email,
        (SELECT COUNT(*) FROM order_items WHERE wp_order_id = o.wp_order_id) as items_count,
        (SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0)
         FROM order_items oi WHERE oi.wp_order_id = o.wp_order_id) as total_cost
      FROM orders o
      LEFT JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE 1=1
    `;

    const params = [];
    let paramIndex = 1;

    // Filtre : Contient produits (AND) - Commande contient TOUS les produits
    if (filters.products && filters.products.operator === 'AND' && filters.products.product_ids?.length > 0) {
      for (const productId of filters.products.product_ids) {
        query += `
          AND EXISTS (
            SELECT 1 FROM order_items
            WHERE wp_order_id = o.wp_order_id AND product_id = $${paramIndex}
          )
        `;
        params.push(productId);
        paramIndex++;
      }
    }

    // Filtre : Contient produits (OR) - Commande contient AU MOINS UN produit
    if (filters.products && filters.products.operator === 'OR' && filters.products.product_ids?.length > 0) {
      query += `
        AND EXISTS (
          SELECT 1 FROM order_items
          WHERE wp_order_id = o.wp_order_id
            AND product_id = ANY($${paramIndex}::bigint[])
        )
      `;
      params.push(filters.products.product_ids);
      paramIndex++;
    }

    // Filtre : Exclusion de produits - Commande NE contient PAS ces produits
    if (filters.exclude && filters.exclude.product_ids?.length > 0) {
      for (const productId of filters.exclude.product_ids) {
        query += `
          AND NOT EXISTS (
            SELECT 1 FROM order_items
            WHERE wp_order_id = o.wp_order_id AND product_id = $${paramIndex}
          )
        `;
        params.push(productId);
        paramIndex++;
      }
    }

    // Filtre : Statut
    if (filters.status) {
      query += ` AND o.post_status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    // Filtre : Pays
    if (filters.country) {
      query += ` AND o.shipping_country = $${paramIndex}`;
      params.push(filters.country);
      paramIndex++;
    }

    // Filtre : Transporteur
    if (filters.shipping_method) {
      query += ` AND o.shipping_method LIKE $${paramIndex}`;
      params.push(`%${filters.shipping_method}%`);
      paramIndex++;
    }

    // Filtre : Montant total
    if (filters.total) {
      if (filters.total.min) {
        query += ` AND o.order_total >= $${paramIndex}`;
        params.push(filters.total.min);
        paramIndex++;
      }
      if (filters.total.max) {
        query += ` AND o.order_total <= $${paramIndex}`;
        params.push(filters.total.max);
        paramIndex++;
      }
    }

    // Filtre : Plage de dates
    if (filters.date_range) {
      if (filters.date_range.from) {
        query += ` AND o.post_date >= $${paramIndex}`;
        params.push(filters.date_range.from);
        paramIndex++;
      }
      if (filters.date_range.to) {
        query += ` AND o.post_date <= $${paramIndex}`;
        params.push(filters.date_range.to);
        paramIndex++;
      }
    }

    // Pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    query += ` ORDER BY o.post_date DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Recherche de produits achetés par des clients ayant acheté un produit X
   * (Produits liés / "Les clients ont aussi acheté")
   */
  async getRelatedProducts(productId, limit = 10) {
    const query = `
      SELECT
        p.wp_product_id as product_id,
        p.post_title as name,
        p.sku,
        p.price,
        p.wc_cog_cost as cost_price,
        COUNT(DISTINCT oi.wp_order_id) as times_bought_together,
        COUNT(DISTINCT o.wp_customer_id) as customers_count,
        SUM(oi.qty) as total_quantity_sold
      FROM products p
      JOIN order_items oi ON oi.product_id = p.wp_product_id
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE o.wp_customer_id IN (
        -- Clients ayant acheté le produit X
        SELECT DISTINCT o2.wp_customer_id
        FROM orders o2
        JOIN order_items oi2 ON oi2.wp_order_id = o2.wp_order_id
        WHERE oi2.product_id = $1
          AND o2.post_status = 'wc-completed'
      )
      AND p.wp_product_id != $1  -- Exclure le produit lui-même
      AND o.post_status = 'wc-completed'
      GROUP BY p.wp_product_id, p.post_title, p.sku, p.price, p.wc_cog_cost
      ORDER BY times_bought_together DESC, customers_count DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [productId, limit]);
    return result.rows;
  }

  /**
   * Compte le nombre de résultats pour une recherche (pagination)
   */
  async countSearchResults(filters = {}, entityType = 'customers') {
    let query;
    const params = [];
    let paramIndex = 1;

    if (entityType === 'customers') {
      query = 'SELECT COUNT(DISTINCT c.wp_user_id) as total FROM customers c WHERE 1=1';

      // Répéter les mêmes filtres que searchCustomers (simplifié)
      if (filters.search) {
        query += `
          AND (
            LOWER(c.first_name || ' ' || c.last_name || ' ' || COALESCE(c.email, ''))
            LIKE $${paramIndex}
          )
        `;
        params.push(`%${filters.search.toLowerCase()}%`);
        paramIndex++;
      }
    } else if (entityType === 'orders') {
      query = 'SELECT COUNT(DISTINCT o.wp_order_id) as total FROM orders o WHERE 1=1';

      if (filters.status) {
        query += ` AND o.post_status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }
    }

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].total);
  }

  /**
   * Exemple de requête complexe : Clients ayant acheté X ET Y mais PAS Z
   */
  async getCustomersBuyingXandYbutNotZ(productX, productY, productZ, limit = 50) {
    const query = `
      SELECT DISTINCT c.*,
        (SELECT COUNT(*) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as order_count,
        (SELECT COALESCE(SUM(order_total), 0) FROM orders WHERE wp_customer_id = c.wp_user_id AND post_status = 'wc-completed') as total_spent
      FROM customers c
      WHERE
        -- A acheté X
        EXISTS (
          SELECT 1 FROM orders o
          JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
          WHERE o.wp_customer_id = c.wp_user_id
            AND oi.product_id = $1
            AND o.post_status = 'wc-completed'
        )
        -- ET a acheté Y
        AND EXISTS (
          SELECT 1 FROM orders o
          JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
          WHERE o.wp_customer_id = c.wp_user_id
            AND oi.product_id = $2
            AND o.post_status = 'wc-completed'
        )
        -- MAIS N'A PAS acheté Z
        AND NOT EXISTS (
          SELECT 1 FROM orders o
          JOIN order_items oi ON oi.wp_order_id = o.wp_order_id
          WHERE o.wp_customer_id = c.wp_user_id
            AND oi.product_id = $3
        )
      ORDER BY total_spent DESC
      LIMIT $4
    `;

    const result = await pool.query(query, [productX, productY, productZ, limit]);
    return result.rows;
  }
}

module.exports = new AdvancedFilterService();
