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

/**
 * Récupère les coupons utilisés par un client
 * GET /api/customers/:id/coupons
 */
exports.getCoupons = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const coupons = await customerModel.getCoupons(customerId);

    res.json({ success: true, data: coupons });
  } catch (error) {
    console.error('Error getting customer coupons:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère tous les clients pour l'onglet Stats avec pagination et filtres
 * GET /api/customers/stats-list?limit=50&offset=0&search=&country=
 */
exports.getStatsListing = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const searchTerm = req.query.search || '';
    const countryFilter = req.query.country || '';

    const customers = await customerModel.getAllForStats(limit, offset, searchTerm, countryFilter);
    const total = await customerModel.countForStats(searchTerm, countryFilter);

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
    console.error('Error getting customers stats listing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère la liste des pays des clients
 * GET /api/customers/countries
 */
exports.getCountries = async (req, res) => {
  try {
    const countries = await customerModel.getCountries();
    res.json({ success: true, data: countries });
  } catch (error) {
    console.error('Error getting countries:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les détails complets d'un client pour la page détail
 * GET /api/customers/:id/detail
 */
exports.getDetail = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const customer = await customerModel.getDetailById(customerId);

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }

    const stats = await customerModel.getStatsForDetail(customerId, customer.email);
    const orders = await customerModel.getOrdersWithReviews(customerId);

    res.json({
      success: true,
      data: {
        customer,
        stats,
        orders
      }
    });
  } catch (error) {
    console.error('Error getting customer detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les détails d'une commande (items + shipping)
 * GET /api/customers/orders/:orderId/details
 */
exports.getOrderDetails = async (req, res) => {
  try {
    const orderId = parseInt(req.params.orderId);
    const details = await customerModel.getOrderDetails(orderId);

    res.json({ success: true, data: details });
  } catch (error) {
    console.error('Error getting order details:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère le nombre de commandes par mois pour un client
 * GET /api/customers/:id/orders-by-month
 */
exports.getOrdersByMonth = async (req, res) => {
  try {
    const customerId = parseInt(req.params.id);
    const ordersByMonth = await customerModel.getOrdersByMonth(customerId);

    res.json({ success: true, data: ordersByMonth });
  } catch (error) {
    console.error('Error getting orders by month:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
