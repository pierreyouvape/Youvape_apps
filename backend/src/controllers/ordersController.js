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
    const filters = {
      search: req.query.search || '',
      country: req.query.country || null,
      status: req.query.status ? req.query.status.split(',') : null,
      minAmount: req.query.minAmount || null,
      maxAmount: req.query.maxAmount || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      shippingMethod: req.query.shippingMethod || null,
      category: req.query.category || null,
      productId: req.query.productId || null,
      limit: parseInt(req.query.limit) || 100,
      offset: parseInt(req.query.offset) || 0
    };

    const result = await orderModel.advancedSearch(filters);

    res.json({
      success: true,
      data: result.orders,
      pagination: result.pagination
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
