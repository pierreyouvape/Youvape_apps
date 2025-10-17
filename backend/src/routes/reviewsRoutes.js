const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Route pour récupérer les avis depuis l'API externe
router.post('/fetch', checkPermission('reviews', 'write'), reviewsController.fetchReviews);

// Routes de configuration
router.post('/config', checkPermission('reviews', 'write'), reviewsController.saveConfig);
router.get('/config', checkPermission('reviews', 'read'), reviewsController.getConfig);
router.post('/toggle-cron', checkPermission('reviews', 'write'), reviewsController.toggleCron);

// Route pour récupérer les avis stockés
router.get('/stored', checkPermission('reviews', 'read'), reviewsController.getStoredReviews);

// Route pour vider tous les avis
router.delete('/stored', checkPermission('reviews', 'write'), reviewsController.deleteAllReviews);

// Route pour créer un avis manuellement
router.post('/manual', checkPermission('reviews', 'write'), reviewsController.createManualReview);

// Route pour mettre à jour le statut récompensé
router.patch('/:id/reward', checkPermission('reviews', 'write'), reviewsController.updateRewardStatus);

// Route pour récupérer les logs
router.get('/logs', checkPermission('reviews', 'read'), reviewsController.getLogs);

// Route pour exporter les logs en CSV
router.get('/logs/export', checkPermission('reviews', 'read'), reviewsController.exportLogs);

module.exports = router;
