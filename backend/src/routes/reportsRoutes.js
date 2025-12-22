const express = require('express');
const router = express.Router();
const reportsController = require('../controllers/reportsController');

// POST /api/reports/revenue - Rapport Chiffre d'affaires
router.post('/revenue', reportsController.getRevenueReport);

// POST /api/reports/by-country - Rapport par Pays
router.post('/by-country', reportsController.getByCountryReport);

// POST /api/reports/by-tax - Rapport par Taux de TVA
router.post('/by-tax', reportsController.getByTaxReport);

module.exports = router;
