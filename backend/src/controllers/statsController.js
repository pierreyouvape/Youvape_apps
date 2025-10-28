const statsService = require('../services/statsService');

/**
 * Récupère les KPI globaux du dashboard
 * GET /api/stats/dashboard
 */
exports.getDashboardKPIs = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      country: req.query.country,
      shippingMethod: req.query.shippingMethod,
      paymentMethod: req.query.paymentMethod
    };

    const kpis = await statsService.getDashboardKPIs(filters);

    res.json({
      success: true,
      data: kpis
    });
  } catch (error) {
    console.error('Error getting dashboard KPIs:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère l'évolution du CA
 * GET /api/stats/revenue-evolution?groupBy=day&period=30d
 */
exports.getRevenueEvolution = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      country: req.query.country
    };

    const groupBy = req.query.groupBy || 'day';
    const evolution = await statsService.getRevenueEvolution(filters, groupBy);

    res.json({
      success: true,
      data: evolution
    });
  } catch (error) {
    console.error('Error getting revenue evolution:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère le top produits
 * GET /api/stats/top-products?limit=10&sortBy=revenue
 */
exports.getTopProducts = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      country: req.query.country
    };

    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'revenue';

    const products = await statsService.getTopProducts(filters, limit, sortBy);

    res.json({
      success: true,
      data: products
    });
  } catch (error) {
    console.error('Error getting top products:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère le top clients
 * GET /api/stats/top-customers?limit=10
 */
exports.getTopCustomers = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status
    };

    const limit = parseInt(req.query.limit) || 10;
    const customers = await statsService.getTopCustomers(filters, limit);

    res.json({
      success: true,
      data: customers
    });
  } catch (error) {
    console.error('Error getting top customers:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats par pays
 * GET /api/stats/by-country
 */
exports.getStatsByCountry = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status
    };

    const stats = await statsService.getStatsByCountry(filters);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats by country:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats par transporteur
 * GET /api/stats/by-shipping-method
 */
exports.getStatsByShippingMethod = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status,
      country: req.query.country
    };

    const stats = await statsService.getStatsByShippingMethod(filters);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats by shipping method:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats par méthode de paiement
 * GET /api/stats/by-payment-method
 */
exports.getStatsByPaymentMethod = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status
    };

    const stats = await statsService.getStatsByPaymentMethod(filters);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats by payment method:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats par catégorie
 * GET /api/stats/by-category
 */
exports.getStatsByCategory = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status
    };

    const stats = await statsService.getStatsByCategory(filters);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats by category:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère le top coupons
 * GET /api/stats/top-coupons?limit=10
 */
exports.getTopCoupons = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      status: req.query.status
    };

    const limit = parseInt(req.query.limit) || 10;
    const coupons = await statsService.getTopCoupons(filters, limit);

    res.json({
      success: true,
      data: coupons
    });
  } catch (error) {
    console.error('Error getting top coupons:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Récupère les stats par statut
 * GET /api/stats/by-status
 */
exports.getStatsByStatus = async (req, res) => {
  try {
    const filters = {
      period: req.query.period,
      startDate: req.query.startDate,
      endDate: req.query.endDate
    };

    const stats = await statsService.getStatsByStatus(filters);

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting stats by status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Compare deux périodes
 * GET /api/stats/comparison?current=30d&previous=60d
 */
exports.getComparison = async (req, res) => {
  try {
    const currentFilters = {
      period: req.query.current || '30d',
      status: req.query.status
    };

    const previousFilters = {
      period: req.query.previous || '60d',
      status: req.query.status
    };

    const comparison = await statsService.getComparison(currentFilters, previousFilters);

    res.json({
      success: true,
      data: comparison
    });
  } catch (error) {
    console.error('Error getting comparison:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};
