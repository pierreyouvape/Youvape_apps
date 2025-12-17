const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/ordersController');

// Liste et recherche
router.get('/', ordersController.getAll);
router.get('/search', ordersController.search);
router.get('/filter', ordersController.filterOrders);
router.post('/advanced-search', ordersController.advancedSearch);
router.get('/statuses/list', ordersController.getStatuses);
router.get('/stats/by-status', ordersController.getStatsByStatus);
router.get('/countries/list', ordersController.getCountries);
router.get('/shipping-methods/list', ordersController.getShippingMethods);
router.get('/categories/list', ordersController.getCategories);
router.get('/status/:status', ordersController.getByStatus);
router.get('/country/:country', ordersController.getByCountry);

// Détails commande
router.get('/:id', ordersController.getById);
router.get('/:id/details', ordersController.getOrderDetails);
router.get('/:id/reviews', ordersController.getOrderReviews);

// Édition
router.put('/:id/shipping-cost', ordersController.updateShippingCost);

module.exports = router;
