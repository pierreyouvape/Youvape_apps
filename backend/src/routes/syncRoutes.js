const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');

// Endpoint de test de connexion
router.get('/ping', syncController.ping);

// Endpoints de réception des données WooCommerce
router.post('/customers', syncController.receiveCustomers);
router.post('/products', syncController.receiveProducts);
router.post('/orders', syncController.receiveOrders);

// Endpoints de téléchargement et gestion des logs
router.get('/logs/:type', syncController.downloadLogs);
router.get('/stats', syncController.getStats);
router.delete('/logs', syncController.clearLogs);

// Endpoints pour gérer les offsets de test manuels
router.get('/test-offsets', syncController.getTestOffsets);
router.post('/test-offsets', syncController.updateTestOffsets);
router.delete('/test-offsets', syncController.resetTestOffsets);

module.exports = router;
