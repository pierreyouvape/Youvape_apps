const express = require('express');
const router = express.Router();
const customersController = require('../controllers/customersController');
const customerNotesController = require('../controllers/customerNotesController');

// Liste et recherche
router.get('/', customersController.getAll);
router.get('/search', customersController.search);
router.post('/advanced-search', customersController.advancedSearch);
router.get('/stats-list', customersController.getStatsListing);
router.get('/countries', customersController.getCountries);

// Détails commande (doit être avant /:id pour éviter conflit)
router.get('/orders/:orderId/details', customersController.getOrderDetails);

// Détails client
router.get('/:id', customersController.getById);
router.get('/:id/detail', customersController.getDetail);
router.get('/:id/orders', customersController.getOrders);
router.get('/:id/orders-by-month', customersController.getOrdersByMonth);
router.get('/:id/favorite-products', customersController.getFavoriteProducts);
router.get('/:id/stats', customersController.getStats);
router.get('/:id/coupons', customersController.getCoupons);

// Notes client
router.get('/:customerId/notes', customerNotesController.getNotes);
router.post('/:customerId/notes', customerNotesController.createNote);
router.put('/notes/:noteId', customerNotesController.updateNote);
router.delete('/notes/:noteId', customerNotesController.deleteNote);

module.exports = router;
