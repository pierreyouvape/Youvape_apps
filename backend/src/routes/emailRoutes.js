const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const authMiddleware = require('../middleware/authMiddleware');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// Configuration
router.post('/config', emailController.saveConfig);
router.get('/config', emailController.getConfig);
router.post('/toggle', emailController.toggleEnabled);

// Test de connexion
router.post('/test-connection', emailController.testConnection);

// Processus d'envoi manuel
router.post('/process', emailController.processEmails);

// Historique
router.get('/history', emailController.getHistory);
router.get('/history/export', emailController.exportHistory);

// Logs
router.get('/logs', emailController.getLogs);
router.get('/logs/export', emailController.exportLogs);

module.exports = router;
