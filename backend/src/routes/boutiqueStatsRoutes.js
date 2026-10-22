/**
 * Boutique › Statistiques (ventes caisse Nextore). Monté avec authMiddleware dans
 * server.js ; le niveau (Conseiller / Responsable) et les boutiques visibles
 * sont tranchés dans le contrôleur.
 */

const express = require('express');
const router = express.Router();
const boutiqueStatsController = require('../controllers/boutiqueStatsController');

router.get('/:shop', boutiqueStatsController.getRankings);
router.get('/:shop/dormants', boutiqueStatsController.getDormants);
router.get('/:shop/dormants/export', boutiqueStatsController.exportDormants);

module.exports = router;
