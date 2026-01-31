const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Middleware pour vérifier l'accès en lecture à l'app stats
const checkStatsRead = checkPermission('stats', 'read');

// Dashboard KPIs
router.get('/dashboard', checkStatsRead, statsController.getDashboardKPIs);

// Évolution du CA
router.get('/revenue-evolution', checkStatsRead, statsController.getRevenueEvolution);

// Top produits
router.get('/top-products', checkStatsRead, statsController.getTopProducts);

// Top clients
router.get('/top-customers', checkStatsRead, statsController.getTopCustomers);

// Stats par pays
router.get('/by-country', checkStatsRead, statsController.getStatsByCountry);

// Stats par transporteur
router.get('/by-shipping-method', checkStatsRead, statsController.getStatsByShippingMethod);

// Stats par méthode de paiement
router.get('/by-payment-method', checkStatsRead, statsController.getStatsByPaymentMethod);

// Stats par catégorie
router.get('/by-category', checkStatsRead, statsController.getStatsByCategory);

// Top coupons
router.get('/top-coupons', checkStatsRead, statsController.getTopCoupons);

// Stats par statut
router.get('/by-status', checkStatsRead, statsController.getStatsByStatus);

// Comparaison entre périodes
router.get('/comparison', checkStatsRead, statsController.getComparison);

module.exports = router;
