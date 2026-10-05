/**
 * Stats boutiques (ventes caisse Nextore). Monté avec authMiddleware dans
 * server.js ; le niveau (Conseiller / Responsable) et les boutiques visibles
 * sont tranchés dans le contrôleur.
 */

const express = require('express');
const router = express.Router();
const boutiqueStatsController = require('../controllers/boutiqueStatsController');

router.get('/access', boutiqueStatsController.getAccess);
router.get('/:shop', boutiqueStatsController.getRankings);

module.exports = router;
