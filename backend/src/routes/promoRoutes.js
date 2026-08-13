const express = require('express');
const router = express.Router();
const promoController = require('../controllers/promoController');

// Sélecteur produits (avant /:id pour ne pas être capté par la route paramétrée)
router.get('/products/search', promoController.searchProducts);
router.get('/products/brands', promoController.listBrands);
router.get('/products/categories', promoController.listCategories);

// Opérations
router.get('/', promoController.listOperations);
router.post('/', promoController.createOperation);
router.get('/:id', promoController.getOperation);
router.put('/:id', promoController.updateOperation);
router.delete('/:id', promoController.deleteOperation);
router.post('/:id/duplicate', promoController.duplicateOperation);
router.get('/:id/export', promoController.exportCsv);

// Analyse avant / pendant
router.get('/:id/analysis', promoController.getAnalysis);

// Lignes produits
router.post('/:id/items', promoController.addItems);
router.put('/:id/items/bulk-discount', promoController.bulkDiscount);
router.put('/:id/items/:itemId', promoController.updateItem);
router.delete('/:id/items/:itemId', promoController.deleteItem);

module.exports = router;
