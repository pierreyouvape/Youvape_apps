const express = require('express');
const router = express.Router();
const productsController = require('../controllers/productsController');

// Liste et recherche
router.get('/', productsController.getAll);
router.get('/search', productsController.search);
router.get('/categories/list', productsController.getCategories);
router.get('/stock-summary', productsController.getStockSummary);
router.get('/category/:category', productsController.getByCategory);

// Détails produit
router.get('/:id', productsController.getById);
router.get('/:id/sales-history', productsController.getSalesHistory);
router.get('/:id/customers', productsController.getCustomers);
router.get('/:id/related', productsController.getRelatedProducts);

// Édition
router.put('/:id/cost', productsController.updateCostPrice);

module.exports = router;
