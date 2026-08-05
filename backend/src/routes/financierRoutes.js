const express = require('express');
const router = express.Router();
const financierController = require('../controllers/financierController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

const checkFinancierRead = checkPermission('financier', 'read');

// POST /api/financier/dashboard
router.post('/dashboard', authMiddleware, checkFinancierRead, financierController.getDashboard);

// POST /api/financier/monthly — série mensuelle des KPIs (graphiques d'évolution au clic)
router.post('/monthly', authMiddleware, checkFinancierRead, financierController.getMonthlySeries);

// POST /api/financier/comptable — déclaration comptable (CA TTC/HT/TVA brut & net, par pays)
router.post('/comptable', authMiddleware, checkFinancierRead, financierController.getComptable);

module.exports = router;
