const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const authMiddleware = require('../middleware/authMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Route pour récupérer les avis depuis l'API externe
router.post('/fetch', reviewsController.fetchReviews);

// Routes de configuration
router.post('/config', reviewsController.saveConfig);
router.get('/config', reviewsController.getConfig);

// Route pour récupérer les avis stockés
router.get('/stored', reviewsController.getStoredReviews);

// Route pour vider tous les avis
router.delete('/stored', reviewsController.deleteAllReviews);

// Route pour créer un avis manuellement
router.post('/manual', reviewsController.createManualReview);

// Route pour mettre à jour le statut récompensé
router.patch('/:id/reward', reviewsController.updateRewardStatus);

// Route pour récupérer les logs
router.get('/logs', reviewsController.getLogs);

// Route pour exporter les logs en CSV
router.get('/logs/export', reviewsController.exportLogs);

module.exports = router;
