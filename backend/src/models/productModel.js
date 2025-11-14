const pool = require('../config/database');

class ProductModel {
  /**
   * Récupère tous les produits avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        p.wc_cog_cost as cost_price,
        (p.price - COALESCE(p.wc_cog_cost, 0)) as unit_margin,
        COALESCE(oi_stats.times_sold, 0) as times_sold,
        COALESCE(oi_stats.total_revenue, 0) as total_revenue
      FROM products p
      LEFT JOIN (
        SELECT
          product_id,
          COUNT(DISTINCT wp_order_id) as times_sold,
          SUM(line_total) as total_revenue
        FROM order_items
        GROUP BY product_id
      ) oi_stats ON oi_stats.product_id = p.wp_product_id
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT $1 OFFSET $2
    `;
    const result = await pool.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Compte le nombre total de produits
   */
  async count() {
    const result = await pool.query('SELECT COUNT(*) as total FROM products');
    return parseInt(result.rows[0].total);
  }

  /**
   * Récupère un produit par ID
   */
  async getById(wpProductId) {
    const query = `
      SELECT
        p.*,
        p.wc_cog_cost as cost_price,
        (p.price - COALESCE(p.wc_cog_cost, 0)) as unit_margin,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE product_id = p.wp_product_id) as total_revenue,
        (SELECT COUNT(DISTINCT wp_order_id) FROM order_items WHERE product_id = p.wp_product_id) as orders_count
      FROM products p
      WHERE p.wp_product_id = $1
    `;
    const result = await pool.query(query, [wpProductId]);
    return result.rows[0];
  }

  /**
   * Récupère un produit par SKU
   */
  async getBySku(sku) {
    const query = 'SELECT * FROM products WHERE sku = $1';
    const result = await pool.query(query, [sku]);
    return result.rows[0];
  }

  /**
   * Recherche de produits (nom, SKU)
   */
  async search(searchTerm, limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        p.wc_cog_cost as cost_price,
        (p.price - COALESCE(p.wc_cog_cost, 0)) as unit_margin,
        COALESCE(oi_stats.total_revenue, 0) as total_revenue
      FROM products p
      LEFT JOIN (
        SELECT
          product_id,
          SUM(line_total) as total_revenue
        FROM order_items
        GROUP BY product_id
      ) oi_stats ON oi_stats.product_id = p.wp_product_id
      WHERE
        LOWER(p.post_title || ' ' || COALESCE(p.sku, '')) LIKE $1
      ORDER BY total_revenue DESC NULLS LAST
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère l'historique des ventes d'un produit
   */
  async getSalesHistory(wpProductId, limit = 50) {
    const query = `
      SELECT
        o.wp_order_id,
        o.post_date as order_date,
        o.post_status as order_status,
        oi.qty as quantity,
        oi.line_total as total,
        oi.item_cost as cost_price
      FROM order_items oi
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.wp_product_id = $1
      ORDER BY o.post_date DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpProductId, limit]);
    return result.rows;
  }

  /**
   * Récupère les statistiques d'un produit
   */
  async getStats(wpProductId) {
    const query = `
      SELECT
        COUNT(DISTINCT oi.wp_order_id)::int as total_orders,
        COALESCE(SUM(oi.qty), 0) as total_quantity_sold,
        COALESCE(SUM(oi.line_total), 0) as total_revenue,
        COALESCE(AVG(oi.line_total / NULLIF(oi.qty, 0)), 0) as avg_price_per_unit,
        MIN(o.post_date) as first_sale_date,
        MAX(o.post_date) as last_sale_date
      FROM products p
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      LEFT JOIN orders o ON o.wp_order_id = oi.wp_order_id AND o.post_status = 'wc-completed'
      WHERE p.wp_product_id = $1
    `;

    const result = await pool.query(query, [wpProductId]);
    const stats = result.rows[0];

    // Calcul du coût total
    const costQuery = `
      SELECT COALESCE(SUM(oi.qty * COALESCE(oi.item_cost, 0)), 0) as total_cost
      FROM order_items oi
      INNER JOIN orders o ON o.wp_order_id = oi.wp_order_id
      WHERE oi.wp_product_id = $1 AND o.post_status = 'wc-completed'
    `;

    const costResult = await pool.query(costQuery, [wpProductId]);
    stats.total_cost = parseFloat(costResult.rows[0]?.total_cost || 0);

    // Calcul profit et marge
    const totalRevenue = parseFloat(stats.total_revenue) || 0;
    const totalCost = parseFloat(stats.total_cost) || 0;

    stats.total_profit = totalRevenue - totalCost;
    stats.margin_percent = totalRevenue > 0 ? ((stats.total_profit / totalRevenue) * 100) : 0;

    return stats;
  }

  /**
   * Récupère les clients qui ont acheté ce produit
   */
  async getCustomers(wpProductId, limit = 50) {
    const query = `
      SELECT
        c.wp_user_id,
        c.email,
        c.first_name,
        c.last_name,
        COUNT(DISTINCT oi.wp_order_id) as orders_count,
        SUM(oi.qty) as total_quantity,
        SUM(oi.line_total) as total_spent
      FROM order_items oi
      JOIN orders o ON o.wp_order_id = oi.wp_order_id
      JOIN customers c ON c.wp_user_id = o.wp_customer_id
      WHERE oi.wp_product_id = $1 AND o.post_status = 'wc-completed'
      GROUP BY c.wp_user_id, c.email, c.first_name, c.last_name
      ORDER BY total_quantity DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [wpProductId, limit]);
    return result.rows;
  }

  /**
   * Récupère les variations d'un produit parent
   */
  async getVariations(wpParentId) {
    const query = `
      SELECT
        p.*,
        p.wc_cog_cost as cost_price,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_revenue
      FROM products p
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY p.post_title ASC
    `;
    const result = await pool.query(query, [wpParentId]);
    return result.rows;
  }

  /**
   * Crée un nouveau produit
   */
  async create(productData) {
    const query = `
      INSERT INTO products (
        wp_product_id, wp_parent_id, product_type, post_title, sku,
        price, regular_price, wc_cog_cost, stock, stock_status, post_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;
    const values = [
      productData.wp_product_id,
      productData.wp_parent_id || null,
      productData.product_type || 'simple',
      productData.post_title,
      productData.sku || null,
      productData.price || null,
      productData.regular_price || null,
      productData.wc_cog_cost || null,
      productData.stock || null,
      productData.stock_status || null,
      productData.post_status || 'publish'
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Met à jour un produit
   */
  async update(wpProductId, productData) {
    const query = `
      UPDATE products
      SET
        post_title = $1,
        sku = $2,
        price = $3,
        regular_price = $4,
        wc_cog_cost = $5,
        stock = $6,
        stock_status = $7,
        post_status = $8,
        updated_at = NOW()
      WHERE wp_product_id = $9
      RETURNING *
    `;
    const values = [
      productData.post_title,
      productData.sku || null,
      productData.price || null,
      productData.regular_price || null,
      productData.wc_cog_cost || null,
      productData.stock || null,
      productData.stock_status || null,
      productData.post_status || 'publish',
      wpProductId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Supprime un produit
   */
  async delete(wpProductId) {
    const query = 'DELETE FROM products WHERE wp_product_id = $1 RETURNING *';
    const result = await pool.query(query, [wpProductId]);
    return result.rows[0];
  }

  /**
   * Récupère le résumé des stocks
   */
  async getStockSummary() {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE stock_status = 'instock') as in_stock,
        COUNT(*) FILTER (WHERE stock_status = 'outofstock') as out_of_stock,
        COUNT(*) FILTER (WHERE stock IS NOT NULL AND CAST(stock AS INTEGER) > 0 AND CAST(stock AS INTEGER) <= 10) as low_stock
      FROM products
      WHERE post_status = 'publish'
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Récupère la famille de produits (parent + toutes ses variations)
   */
  async getFamily(wpProductId) {
    // D'abord déterminer si c'est un parent ou une variation
    const productQuery = `
      SELECT wp_product_id, wp_parent_id, product_type
      FROM products
      WHERE wp_product_id = $1
    `;
    const productResult = await pool.query(productQuery, [wpProductId]);

    if (productResult.rows.length === 0) {
      return null;
    }

    const product = productResult.rows[0];
    const parentId = product.wp_parent_id || product.wp_product_id;

    // Récupère le parent et toutes les variations
    const familyQuery = `
      SELECT
        p.*,
        p.wc_cog_cost as cost_price,
        (p.price - COALESCE(p.wc_cog_cost, 0)) as unit_margin,
        (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE wp_product_id = p.wp_product_id) as total_revenue
      FROM products p
      WHERE p.wp_product_id = $1 OR p.wp_parent_id = $1
      ORDER BY p.product_type DESC, p.post_title ASC
    `;
    const result = await pool.query(familyQuery, [parentId]);
    return result.rows;
  }

  /**
   * Récupère les statistiques de variations d'un produit
   */
  async getVariantStats(wpProductId) {
    const query = `
      SELECT
        p.wp_product_id,
        p.post_title,
        p.product_attributes,
        p.stock,
        p.stock_status,
        p.price,
        p.wc_cog_cost as cost_price,
        COALESCE(SUM(oi.qty), 0) as total_sold,
        COALESCE(SUM(oi.line_total), 0) as total_revenue,
        COALESCE(SUM(oi.qty * oi.item_cost), 0) as total_cost
      FROM products p
      LEFT JOIN order_items oi ON oi.wp_product_id = p.wp_product_id
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      GROUP BY p.wp_product_id, p.post_title, p.product_attributes, p.stock, p.stock_status, p.price, p.wc_cog_cost
      ORDER BY total_sold DESC
    `;
    const result = await pool.query(query, [wpProductId]);
    return result.rows;
  }
}

module.exports = new ProductModel();
