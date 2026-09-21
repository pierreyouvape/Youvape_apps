const express = require('express');
const router = express.Router();
const brandsController = require('../controllers/brandsController');

// Liste toutes les marques
router.get('/', brandsController.getAll);

// Liste toutes les sous-marques
router.get('/sub-brands', brandsController.getAllSubBrands);

// CA mensuel (vue « Par mois » de /stats) — avant /:name
router.get('/monthly', brandsController.getMonthly);

// Détails d'une marque avec ses sous-marques et produits
router.get('/:brandName', brandsController.getByName);

// Détails d'une sous-marque avec ses produits
router.get('/sub-brands/:subBrandName', brandsController.getSubBrandByName);

module.exports = router;
