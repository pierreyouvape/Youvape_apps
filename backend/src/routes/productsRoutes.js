const express = require('express');
const router = express.Router();
const productsController = require('../controllers/productsController');
const productStatsController = require('../controllers/productStatsController');

// Liste et recherche
router.get('/', productsController.getAll);
router.get('/search', productsController.search);
router.get('/categories/list', productsController.getCategories);
router.get('/stock-summary', productsController.getStockSummary);
router.get('/category/:category', productsController.getByCategory);
router.get('/stats-list', productsController.getStatsListing);

// Détails produit
router.get('/:id', productsController.getById);
router.get('/:id/sales-history', productsController.getSalesHistory);
router.get('/:id/customers', productsController.getCustomers);
router.get('/:id/related', productsController.getRelatedProducts);

// Stats produit avancées
router.get('/:id/family', productStatsController.getFamily);
router.get('/:id/stats/kpis', productStatsController.getKPIs);
router.get('/:id/stats/variant', productStatsController.getVariantStats);
router.get('/:id/stats/all-variants', productStatsController.getAllVariantsStats);
router.get('/:id/stats/evolution', productStatsController.getSalesEvolution);
router.get('/:id/stats/variants-by-period', productStatsController.getVariantsStatsByPeriod);
router.get('/:id/stats/frequently-bought-with', productStatsController.getFrequentlyBoughtWith);
router.get('/:id/stats/by-country', productStatsController.getSalesByCountry);
router.get('/:id/stats/top-customers', productStatsController.getTopCustomers);
router.get('/:id/stats/recent-orders', productStatsController.getRecentOrders);
router.get('/:id/stats/by-day-of-week', productStatsController.getSalesByDayOfWeek);
router.get('/:id/stats/by-hour', productStatsController.getSalesByHour);
router.get('/:id/variations-stats', productsController.getVariationsStats);

// Édition
router.put('/:id/cost', productsController.updateCostPrice);

module.exports = router;
