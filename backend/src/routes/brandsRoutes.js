const express = require('express');
const router = express.Router();
const brandsController = require('../controllers/brandsController');

// Liste toutes les marques
router.get('/', brandsController.getAll);

// Liste toutes les sous-marques
router.get('/sub-brands', brandsController.getAllSubBrands);

// Détails d'une marque avec ses sous-marques et produits
router.get('/:brandName', brandsController.getByName);

// Détails d'une sous-marque avec ses produits
router.get('/sub-brands/:subBrandName', brandsController.getSubBrandByName);

module.exports = router;
