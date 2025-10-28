const express = require('express');
const router = express.Router();
const customersController = require('../controllers/customersController');

// Liste et recherche
router.get('/', customersController.getAll);
router.get('/search', customersController.search);
router.post('/advanced-search', customersController.advancedSearch);

// Détails client
router.get('/:id', customersController.getById);
router.get('/:id/orders', customersController.getOrders);
router.get('/:id/favorite-products', customersController.getFavoriteProducts);
router.get('/:id/stats', customersController.getStats);

module.exports = router;
