const express = require('express');
const router = express.Router();
const rewardsController = require('../controllers/rewardsController');
const authMiddleware = require('../middleware/authMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Routes de configuration
router.post('/config', rewardsController.saveConfig);
router.get('/config', rewardsController.getConfig);

// Test de connexion API
router.post('/test-connection', rewardsController.testConnection);

// Lancer le processus de récompense manuellement
router.post('/process', rewardsController.processRewards);

// Historique des récompenses
router.get('/history', rewardsController.getHistory);
router.get('/history/export', rewardsController.exportHistory);

// Activer/Désactiver le système
router.post('/toggle', rewardsController.toggleEnabled);

// Récompenser manuellement un avis spécifique
router.post('/manual', rewardsController.rewardManual);

module.exports = router;
