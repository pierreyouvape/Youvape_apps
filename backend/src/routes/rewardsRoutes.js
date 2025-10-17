const express = require('express');
const router = express.Router();
const rewardsController = require('../controllers/rewardsController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Routes de configuration
router.post('/config', checkPermission('rewards', 'write'), rewardsController.saveConfig);
router.get('/config', checkPermission('rewards', 'read'), rewardsController.getConfig);

// Test de connexion API
router.post('/test-connection', checkPermission('rewards', 'read'), rewardsController.testConnection);

// Lancer le processus de récompense manuellement
router.post('/process', checkPermission('rewards', 'write'), rewardsController.processRewards);

// Historique des récompenses
router.get('/history', checkPermission('rewards', 'read'), rewardsController.getHistory);
router.get('/history/export', checkPermission('rewards', 'read'), rewardsController.exportHistory);

// Activer/Désactiver le système
router.post('/toggle', checkPermission('rewards', 'write'), rewardsController.toggleEnabled);

// Récompenser manuellement un avis spécifique
router.post('/manual', checkPermission('rewards', 'write'), rewardsController.rewardManual);

module.exports = router;
