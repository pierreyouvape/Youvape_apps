const pool = require('../config/database');

class ProductModel {
  /**
   * Récupère tous les produits avec pagination
   */
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.cost_price_custom, p.cost_price) as effective_cost_price,
        (p.price - COALESCE(p.cost_price_custom, p.cost_price)) as unit_margin,
        (SELECT COUNT(*) FROM order_items WHERE product_id = p.product_id) as times_sold,
        (SELECT COALESCE(SUM(total), 0) FROM order_items WHERE product_id = p.product_id) as total_revenue
      FROM products p
      ORDER BY total_revenue DESC
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
  async getById(productId) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.cost_price_custom, p.cost_price) as effective_cost_price,
        (p.price - COALESCE(p.cost_price_custom, p.cost_price)) as unit_margin,
        (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE product_id = p.product_id) as total_quantity_sold,
        (SELECT COALESCE(SUM(total), 0) FROM order_items WHERE product_id = p.product_id) as total_revenue,
        (SELECT COUNT(DISTINCT order_id) FROM order_items WHERE product_id = p.product_id) as orders_count
      FROM products p
      WHERE p.product_id = $1
    `;
    const result = await pool.query(query, [productId]);
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
   * Recherche de produits (nom, SKU, catégorie)
   */
  async search(searchTerm, limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.cost_price_custom, p.cost_price) as effective_cost_price,
        (p.price - COALESCE(p.cost_price_custom, p.cost_price)) as unit_margin,
        (SELECT COALESCE(SUM(total), 0) FROM order_items WHERE product_id = p.product_id) as total_revenue
      FROM products p
      WHERE
        LOWER(p.name || ' ' || COALESCE(p.sku, '') || ' ' || COALESCE(p.category, '')) LIKE $1
      ORDER BY total_revenue DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${searchTerm.toLowerCase()}%`, limit, offset]);
    return result.rows;
  }

  /**
   * Filtre produits par catégorie
   */
  async getByCategory(category, limit = 50, offset = 0) {
    const query = `
      SELECT
        p.*,
        COALESCE(p.cost_price_custom, p.cost_price) as effective_cost_price,
        (p.price - COALESCE(p.cost_price_custom, p.cost_price)) as unit_margin
      FROM products p
      WHERE p.category = $1
      ORDER BY p.name ASC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [category, limit, offset]);
    return result.rows;
  }

  /**
   * Récupère l'historique des ventes d'un produit
   */
  async getSalesHistory(productId, limit = 50) {
    const query = `
      SELECT
        o.order_id,
        o.order_number,
        o.date_created,
        o.status,
        oi.quantity,
        oi.price,
        oi.total,
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email
      FROM order_items oi
      JOIN orders o ON o.order_id = oi.order_id
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      WHERE oi.product_id = $1
      ORDER BY o.date_created DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [productId, limit]);
    return result.rows;
  }

  /**
   * Récupère les clients ayant acheté un produit
   */
  async getCustomers(productId, limit = 50) {
    const query = `
      SELECT
        c.customer_id,
        c.first_name,
        c.last_name,
        c.email,
        COUNT(DISTINCT o.order_id) as order_count,
        SUM(oi.quantity) as total_quantity,
        SUM(oi.total) as total_spent
      FROM customers c
      JOIN orders o ON o.customer_id = c.customer_id
      JOIN order_items oi ON oi.order_id = o.order_id
      WHERE oi.product_id = $1
      GROUP BY c.customer_id
      ORDER BY total_spent DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [productId, limit]);
    return result.rows;
  }

  /**
   * Récupère les produits liés (achetés ensemble)
   */
  async getRelatedProducts(productId, limit = 10) {
    const query = `
      SELECT
        p.product_id,
        p.name,
        p.sku,
        p.image_url,
        p.price,
        COUNT(DISTINCT oi.order_id) as times_bought_together,
        COUNT(DISTINCT o.customer_id) as customers_count
      FROM products p
      JOIN order_items oi ON oi.product_id = p.product_id
      JOIN orders o ON o.order_id = oi.order_id
      WHERE o.customer_id IN (
        SELECT DISTINCT o2.customer_id
        FROM orders o2
        JOIN order_items oi2 ON oi2.order_id = o2.order_id
        WHERE oi2.product_id = $1
      )
      AND p.product_id != $1
      GROUP BY p.product_id
      ORDER BY times_bought_together DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [productId, limit]);
    return result.rows;
  }

  /**
   * Met à jour le coût personnalisé d'un produit
   */
  async updateCostPrice(productId, costPriceCustom) {
    const query = `
      UPDATE products
      SET
        cost_price_custom = $1,
        cost_price_updated_at = NOW(),
        updated_at = NOW()
      WHERE product_id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [costPriceCustom, productId]);
    return result.rows[0];
  }

  /**
   * Récupère toutes les catégories distinctes
   */
  async getCategories() {
    const query = `
      SELECT DISTINCT category
      FROM products
      WHERE category IS NOT NULL
      ORDER BY category ASC
    `;
    const result = await pool.query(query);
    return result.rows.map(row => row.category);
  }

  /**
   * Récupère le récapitulatif du stock
   */
  async getStockSummary() {
    const query = `
      SELECT
        COUNT(*) FILTER (WHERE stock_status = 'instock' AND COALESCE(stock_quantity, 0) > 0) as in_stock,
        COUNT(*) FILTER (WHERE stock_status = 'outofstock' OR COALESCE(stock_quantity, 0) = 0) as out_of_stock,
        COUNT(*) FILTER (WHERE stock_status = 'instock' AND COALESCE(stock_quantity, 0) > 0 AND COALESCE(stock_quantity, 0) <= 10) as low_stock
      FROM products
    `;
    const result = await pool.query(query);
    return result.rows[0];
  }

  /**
   * Crée un nouveau produit
   */
  async create(productData) {
    const query = `
      INSERT INTO products (
        product_id, sku, name, price, regular_price, sale_price, cost_price,
        stock_quantity, stock_status, category, categories,
        date_created, date_modified, total_sales, image_url
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *
    `;
    const values = [
      productData.product_id,
      productData.sku || null,
      productData.name,
      productData.price || 0,
      productData.regular_price || null,
      productData.sale_price || null,
      productData.cost_price || null,
      productData.stock_quantity || null,
      productData.stock_status || 'instock',
      productData.category || null,
      JSON.stringify(productData.categories || []),
      productData.date_created || null,
      productData.date_modified || null,
      productData.total_sales || 0,
      productData.image_url || null
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Met à jour un produit
   */
  async update(productId, productData) {
    const query = `
      UPDATE products
      SET
        name = $1,
        price = $2,
        regular_price = $3,
        sale_price = $4,
        cost_price = $5,
        stock_quantity = $6,
        stock_status = $7,
        category = $8,
        categories = $9,
        updated_at = NOW()
      WHERE product_id = $10
      RETURNING *
    `;
    const values = [
      productData.name,
      productData.price || 0,
      productData.regular_price || null,
      productData.sale_price || null,
      productData.cost_price || null,
      productData.stock_quantity || null,
      productData.stock_status || 'instock',
      productData.category || null,
      JSON.stringify(productData.categories || []),
      productId
    ];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Supprime un produit
   */
  async delete(productId) {
    const query = 'DELETE FROM products WHERE product_id = $1 RETURNING *';
    const result = await pool.query(query, [productId]);
    return result.rows[0];
  }
}

module.exports = new ProductModel();
