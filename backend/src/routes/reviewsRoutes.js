const express = require('express');
const router = express.Router();
const reviewsController = require('../controllers/reviewsController');
const authMiddleware = require('../middleware/authMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Route pour récupérer les avis depuis l'API externe
router.post('/fetch', reviewsController.fetchReviews);

// Route pour récupérer les logs
router.get('/logs', reviewsController.getLogs);

// Route pour exporter les logs en CSV
router.get('/logs/export', reviewsController.exportLogs);

module.exports = router;
