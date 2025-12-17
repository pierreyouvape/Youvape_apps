const orderModel = require('../models/orderModel');
const advancedFilterService = require('../services/advancedFilterService');

/**
 * Récupère toutes les commandes
 * GET /api/orders
 */
exports.getAll = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getAll(limit, offset);
    const total = await orderModel.count();

    res.json({
      success: true,
      data: orders,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error getting orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère une commande par ID
 * GET /api/orders/:id
 */
exports.getById = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const order = await orderModel.getById(orderId);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error getting order:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche simple de commandes
 * GET /api/orders/search?q=12345
 */
exports.search = async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.search(searchTerm, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error searching orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche avancée avec filtres croisés
 * POST /api/orders/advanced-search
 * Body: { products: { operator: 'AND', product_ids: [123, 456] }, status: 'completed', country: 'FR', ... }
 */
exports.advancedSearch = async (req, res) => {
  try {
    const filters = req.body;
    const orders = await advancedFilterService.searchOrders(filters);

    res.json({ success: true, data: orders, count: orders.length });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Filtre commandes par statut
 * GET /api/orders/status/:status
 */
exports.getByStatus = async (req, res) => {
  try {
    const status = req.params.status;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getByStatus(status, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting orders by status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Filtre commandes par pays
 * GET /api/orders/country/:country
 */
exports.getByCountry = async (req, res) => {
  try {
    const country = req.params.country;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const orders = await orderModel.getByCountry(country, limit, offset);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting orders by country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les statuts existants
 * GET /api/orders/statuses/list
 */
exports.getStatuses = async (req, res) => {
  try {
    const statuses = await orderModel.getStatuses();
    res.json({ success: true, data: statuses });
  } catch (error) {
    console.error('Error getting statuses:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les statistiques par statut
 * GET /api/orders/stats/by-status
 */
exports.getStatsByStatus = async (req, res) => {
  try {
    const stats = await orderModel.getStatsByStatus();
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting stats by status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les pays existants
 * GET /api/orders/countries/list
 */
exports.getCountries = async (req, res) => {
  try {
    const countries = await orderModel.getCountries();
    res.json({ success: true, data: countries });
  } catch (error) {
    console.error('Error getting countries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les transporteurs existants
 * GET /api/orders/shipping-methods/list
 */
exports.getShippingMethods = async (req, res) => {
  try {
    const methods = await orderModel.getShippingMethods();
    res.json({ success: true, data: methods });
  } catch (error) {
    console.error('Error getting shipping methods:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère toutes les catégories pour le filtre commandes
 * GET /api/orders/categories/list
 */
exports.getCategories = async (req, res) => {
  try {
    const pool = require('../config/database');
    const query = `
      SELECT DISTINCT category, COUNT(DISTINCT wp_product_id) as product_count
      FROM products
      WHERE category IS NOT NULL AND category != ''
      AND product_type IN ('simple', 'variable', 'woosb')
      GROUP BY category
      ORDER BY category
    `;
    const result = await pool.query(query);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche avancée avec tous les filtres combinés
 * GET /api/orders/filter
 */
exports.filterOrders = async (req, res) => {
  try {
    const pool = require('../config/database');

    const conditions = [];
    const params = [];
    let paramIndex = 1;

    // Recherche texte (numéro commande, nom, prénom, email)
    if (req.query.search) {
      conditions.push(`(
        CAST(o.wp_order_id AS TEXT) ILIKE $${paramIndex}
        OR o.billing_first_name ILIKE $${paramIndex}
        OR o.billing_last_name ILIKE $${paramIndex}
        OR o.billing_email ILIKE $${paramIndex}
        OR CONCAT(o.billing_first_name, ' ', o.billing_last_name) ILIKE $${paramIndex}
      )`);
      params.push(`%${req.query.search}%`);
      paramIndex++;
    }

    // Filtre par pays
    if (req.query.country) {
      conditions.push(`o.billing_country = $${paramIndex}`);
      params.push(req.query.country);
      paramIndex++;
    }

    // Filtre par statut (peut être un tableau séparé par virgules)
    if (req.query.status) {
      const statuses = req.query.status.split(',');
      conditions.push(`o.post_status = ANY($${paramIndex})`);
      params.push(statuses);
      paramIndex++;
    }

    // Filtre par montant minimum
    if (req.query.minAmount) {
      conditions.push(`o.order_total >= $${paramIndex}`);
      params.push(parseFloat(req.query.minAmount));
      paramIndex++;
    }

    // Filtre par montant maximum
    if (req.query.maxAmount) {
      conditions.push(`o.order_total <= $${paramIndex}`);
      params.push(parseFloat(req.query.maxAmount));
      paramIndex++;
    }

    // Filtre par date de début
    if (req.query.dateFrom) {
      conditions.push(`o.post_date >= $${paramIndex}`);
      params.push(req.query.dateFrom);
      paramIndex++;
    }

    // Filtre par date de fin
    if (req.query.dateTo) {
      conditions.push(`o.post_date <= $${paramIndex}::date + interval '1 day'`);
      params.push(req.query.dateTo);
      paramIndex++;
    }

    // Filtre par transporteur
    if (req.query.shippingMethod) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_ship
        WHERE oi_ship.wp_order_id = o.wp_order_id
        AND oi_ship.order_item_type = 'shipping'
        AND oi_ship.order_item_name = $${paramIndex}
      )`);
      params.push(req.query.shippingMethod);
      paramIndex++;
    }

    // Filtre par catégorie de produit
    if (req.query.category) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_cat
        JOIN products p_cat ON (CAST(p_cat.wp_product_id AS TEXT) = oi_cat.product_id OR CAST(p_cat.wp_product_id AS TEXT) = oi_cat.variation_id)
        WHERE oi_cat.wp_order_id = o.wp_order_id
        AND oi_cat.order_item_type = 'line_item'
        AND (p_cat.category = $${paramIndex} OR p_cat.sub_category = $${paramIndex})
      )`);
      params.push(req.query.category);
      paramIndex++;
    }

    // Filtre par produit spécifique
    if (req.query.productId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM order_items oi_prod
        WHERE oi_prod.wp_order_id = o.wp_order_id
        AND oi_prod.order_item_type = 'line_item'
        AND (oi_prod.product_id = $${paramIndex} OR oi_prod.variation_id = $${paramIndex})
      )`);
      params.push(req.query.productId);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    // Compter le total
    const countQuery = `SELECT COUNT(*) as total FROM orders o ${whereClause}`;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Récupérer les commandes
    const query = `
      SELECT
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
        (SELECT COUNT(*) FROM order_items oi_c WHERE oi_c.wp_order_id = o.wp_order_id AND oi_c.order_item_type = 'line_item') as items_count,
        (SELECT COUNT(*) > 0 FROM reviews WHERE order_id = o.wp_order_id::text) as has_review
      FROM orders o
      ${whereClause}
      ORDER BY o.post_date DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error filtering orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les détails d'une commande pour l'affichage dépliable
 * GET /api/orders/:id/details
 */
exports.getOrderDetails = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const details = await orderModel.getOrderDetails(orderId);
    res.json({ success: true, data: details });
  } catch (error) {
    console.error('Error getting order details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les avis associés à une commande
 * GET /api/orders/:id/reviews
 */
exports.getOrderReviews = async (req, res) => {
  try {
    const pool = require('../config/database');
    const orderId = req.params.id;

    const query = `
      SELECT
        r.*,
        p.post_title as product_name,
        p.image_url as product_image
      FROM reviews r
      LEFT JOIN products p ON p.wp_product_id::text = r.product_id
      WHERE r.order_id = $1
      ORDER BY r.review_date DESC
    `;
    const result = await pool.query(query, [orderId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getting order reviews:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Met à jour le coût réel de livraison
 * PUT /api/orders/:id/shipping-cost
 * Body: { shipping_cost_real: 8.50 }
 */
exports.updateShippingCost = async (req, res) => {
  try {
    const orderId = parseInt(req.params.id);
    const { shipping_cost_real } = req.body;

    if (shipping_cost_real === undefined || shipping_cost_real === null) {
      return res.status(400).json({
        success: false,
        error: 'shipping_cost_real is required'
      });
    }

    const order = await orderModel.updateShippingCost(orderId, shipping_cost_real);

    if (!order) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    res.json({
      success: true,
      message: 'Shipping cost updated successfully',
      data: order
    });
  } catch (error) {
    console.error('Error updating shipping cost:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
