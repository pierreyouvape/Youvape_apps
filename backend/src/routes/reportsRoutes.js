const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');

// POST /api/reports/revenue - Rapport Chiffre d'affaires
router.post('/revenue', reportsController.getRevenueReport);

// POST /api/reports/by-country - Rapport par Pays
router.post('/by-country', reportsController.getByCountryReport);

// POST /api/reports/by-tax - Rapport par Taux de TVA
router.post('/by-tax', reportsController.getByTaxReport);

// POST /api/reports/profit - Rapport Profit
router.post('/profit', reportsController.getProfitReport);

// POST /api/reports/profit/transaction-costs - Coûts de transaction par méthode de paiement
router.post('/profit/transaction-costs', reportsController.getTransactionCosts);

// POST /api/reports/profit/shipping-costs - Coûts d'expédition par méthode
router.post('/profit/shipping-costs', reportsController.getShippingCosts);

// POST /api/reports/orders - Rapport Commandes
router.post('/orders', reportsController.getOrdersReport);

// POST /api/reports/refunds - Rapport Remboursements
router.post('/refunds', reportsController.getRefundsReport);

module.exports = router;
