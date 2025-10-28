const customerModel = require('../models/customerModel');
const advancedFilterService = require('../services/advancedFilterService');

/**
 * Récupère tous les clients
 * GET /api/customers
 */
exports.getAll = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const customers = await customerModel.getAll(limit, offset);
    const total = await customerModel.count();

    res.json({
      success: true,
      data: customers,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error getting customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère un client par ID
 * GET /api/customers/:id
 */
exports.getById = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const customer = await customerModel.getById(customerId);

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    console.error('Error getting customer:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche simple de clients
 * GET /api/customers/search?q=john
 */
exports.search = async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const customers = await customerModel.search(searchTerm, limit, offset);

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error searching customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche avancée avec filtres croisés
 * POST /api/customers/advanced-search
 * Body: { products: { operator: 'AND', product_ids: [123, 456] }, exclude: { product_ids: [789] }, ... }
 */
exports.advancedSearch = async (req, res) => {
  try {
    const filters = req.body;
    const customers = await advancedFilterService.searchCustomers(filters);

    res.json({ success: true, data: customers, count: customers.length });
  } catch (error) {
    console.error('Error in advanced search:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère l'historique des commandes d'un client
 * GET /api/customers/:id/orders
 */
exports.getOrders = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;

    const orders = await customerModel.getOrders(customerId, limit);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting customer orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les produits favoris d'un client
 * GET /api/customers/:id/favorite-products
 */
exports.getFavoriteProducts = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 10;

    const products = await customerModel.getFavoriteProducts(customerId, limit);

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error getting customer favorite products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les statistiques d'un client
 * GET /api/customers/:id/stats
 */
exports.getStats = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const stats = await customerModel.getStats(customerId);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting customer stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
