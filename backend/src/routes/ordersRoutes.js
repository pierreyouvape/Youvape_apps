const express = require('express');
const router = express.Router();
const ordersController = require('../controllers/ordersController');

// Liste et recherche
router.get('/', ordersController.getAll);
router.get('/search', ordersController.search);
router.post('/advanced-search', ordersController.advancedSearch);
router.get('/statuses/list', ordersController.getStatuses);
router.get('/countries/list', ordersController.getCountries);
router.get('/status/:status', ordersController.getByStatus);
router.get('/country/:country', ordersController.getByCountry);

// Détails commande
router.get('/:id', ordersController.getById);

// Édition
router.put('/:id/shipping-cost', ordersController.updateShippingCost);

module.exports = router;
