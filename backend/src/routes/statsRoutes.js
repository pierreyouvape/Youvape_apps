const express = require('express');
const router = express.Router();
const statsController = require('../controllers/statsController');

// Dashboard KPIs
router.get('/dashboard', statsController.getDashboardKPIs);

// Évolution du CA
router.get('/revenue-evolution', statsController.getRevenueEvolution);

// Top produits
router.get('/top-products', statsController.getTopProducts);

// Top clients
router.get('/top-customers', statsController.getTopCustomers);

// Stats par pays
router.get('/by-country', statsController.getStatsByCountry);

// Stats par transporteur
router.get('/by-shipping-method', statsController.getStatsByShippingMethod);

// Stats par méthode de paiement
router.get('/by-payment-method', statsController.getStatsByPaymentMethod);

// Stats par catégorie
router.get('/by-category', statsController.getStatsByCategory);

// Top coupons
router.get('/top-coupons', statsController.getTopCoupons);

// Stats par statut
router.get('/by-status', statsController.getStatsByStatus);

// Comparaison entre périodes
router.get('/comparison', statsController.getComparison);

module.exports = router;
