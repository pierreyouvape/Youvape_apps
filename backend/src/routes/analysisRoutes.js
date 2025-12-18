const express = require('express');
const router = express.Router();
const analysisController = require('../controllers/analysisController');

// GET /api/analysis/filters - Récupérer les valeurs disponibles pour les filtres
router.get('/filters', analysisController.getFilters);

// POST /api/analysis/stats - Calculer les statistiques selon les filtres
router.post('/stats', analysisController.getStats);

module.exports = router;
