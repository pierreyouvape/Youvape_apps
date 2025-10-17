const express = require('express');
const router = express.Router();
const emailController = require('../controllers/emailController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// Configuration
router.post('/config', checkPermission('emails', 'write'), emailController.saveConfig);
router.get('/config', checkPermission('emails', 'read'), emailController.getConfig);
router.post('/toggle', checkPermission('emails', 'write'), emailController.toggleEnabled);

// Test de connexion
router.post('/test-connection', checkPermission('emails', 'read'), emailController.testConnection);

// Processus d'envoi manuel
router.post('/process', checkPermission('emails', 'write'), emailController.processEmails);

// Historique
router.get('/history', checkPermission('emails', 'read'), emailController.getHistory);
router.get('/history/export', checkPermission('emails', 'read'), emailController.exportHistory);

// Logs
router.get('/logs', checkPermission('emails', 'read'), emailController.getLogs);
router.get('/logs/export', checkPermission('emails', 'read'), emailController.exportLogs);

module.exports = router;
