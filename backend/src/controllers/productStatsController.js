const productStatsService = require('../services/productStatsService');

/**
 * Récupère la famille de produits (parent + variantes)
 * GET /api/products/:id/family
 */
exports.getFamily = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const family = await productStatsService.getProductFamily(productId);

    res.json({ success: true, data: family });
  } catch (error) {
    console.error('Error getting product family:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les KPIs globaux du produit
 * GET /api/products/:id/stats/kpis?includeVariants=true
 */
exports.getKPIs = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';

    const kpis = await productStatsService.getProductKPIs(productId, includeVariants);

    res.json({ success: true, data: kpis });
  } catch (error) {
    console.error('Error getting product KPIs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les stats par variante
 * GET /api/products/:id/stats/variant
 */
exports.getVariantStats = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const stats = await productStatsService.getVariantStats(productId);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting variant stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les stats pour toutes les variantes d'une famille
 * GET /api/products/:id/stats/all-variants?startDate=2024-01-01&endDate=2024-12-31
 */
exports.getAllVariantsStats = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    const stats = await productStatsService.getAllVariantsStats(productId, startDate, endDate);

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting all variants stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère l'évolution des ventes
 * GET /api/products/:id/stats/evolution?groupBy=day&includeVariants=true&startDate=2024-01-01&endDate=2024-12-31&variantId=123
 */
exports.getSalesEvolution = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';
    const groupBy = req.query.groupBy || 'day';
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;
    const variantId = req.query.variantId ? parseInt(req.query.variantId) : null;

    const evolution = await productStatsService.getSalesEvolution(
      productId,
      includeVariants,
      groupBy,
      startDate,
      endDate,
      variantId
    );

    res.json({ success: true, data: evolution });
  } catch (error) {
    console.error('Error getting sales evolution:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les stats des variantes pour une période donnée
 * GET /api/products/:id/stats/variants-by-period?startDate=2024-01-01&endDate=2024-12-31
 */
exports.getVariantsStatsByPeriod = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const startDate = req.query.startDate || null;
    const endDate = req.query.endDate || null;

    const stats = await productStatsService.getVariantsStatsByPeriod(
      productId,
      startDate,
      endDate
    );

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting variants stats by period:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les produits fréquemment achetés ensemble
 * GET /api/products/:id/stats/frequently-bought-with?limit=10
 */
exports.getFrequentlyBoughtWith = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 10;

    const products = await productStatsService.getFrequentlyBoughtWith(productId, limit);

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error getting frequently bought with:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les ventes par pays
 * GET /api/products/:id/stats/by-country?includeVariants=true
 */
exports.getSalesByCountry = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';

    const salesByCountry = await productStatsService.getSalesByCountry(productId, includeVariants);

    res.json({ success: true, data: salesByCountry });
  } catch (error) {
    console.error('Error getting sales by country:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère le top des clients
 * GET /api/products/:id/stats/top-customers?includeVariants=true&limit=10
 */
exports.getTopCustomers = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';
    const limit = parseInt(req.query.limit) || 10;

    const customers = await productStatsService.getTopCustomers(productId, includeVariants, limit);

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error getting top customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les commandes récentes
 * GET /api/products/:id/stats/recent-orders?includeVariants=true&limit=20
 */
exports.getRecentOrders = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';
    const limit = parseInt(req.query.limit) || 20;

    const orders = await productStatsService.getRecentOrders(productId, includeVariants, limit);

    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error getting recent orders:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les ventes par jour de la semaine
 * GET /api/products/:id/stats/by-day-of-week?includeVariants=true
 */
exports.getSalesByDayOfWeek = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';

    const salesByDay = await productStatsService.getSalesByDayOfWeek(productId, includeVariants);

    res.json({ success: true, data: salesByDay });
  } catch (error) {
    console.error('Error getting sales by day of week:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les ventes par heure
 * GET /api/products/:id/stats/by-hour?includeVariants=true
 */
exports.getSalesByHour = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const includeVariants = req.query.includeVariants !== 'false';

    const salesByHour = await productStatsService.getSalesByHour(productId, includeVariants);

    res.json({ success: true, data: salesByHour });
  } catch (error) {
    console.error('Error getting sales by hour:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
