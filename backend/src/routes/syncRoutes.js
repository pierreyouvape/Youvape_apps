const express = require('express');
const router = express.Router();
const syncController = require('../controllers/syncController');

// Endpoints de réception des données WooCommerce
router.post('/customers', syncController.receiveCustomers);
router.post('/products', syncController.receiveProducts);
router.post('/orders', syncController.receiveOrders);

// Endpoints de téléchargement et gestion des logs
router.get('/logs/:type', syncController.downloadLogs);
router.get('/stats', syncController.getStats);
router.delete('/logs', syncController.clearLogs);

module.exports = router;
