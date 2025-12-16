const express = require('express');
const router = express.Router();
const categoriesController = require('../controllers/categoriesController');

// Liste toutes les catégories
router.get('/', categoriesController.getAll);

// Liste toutes les sous-catégories
router.get('/sub-categories', categoriesController.getAllSubCategories);

// Détails d'une catégorie avec ses sous-catégories et produits
router.get('/:categoryName', categoriesController.getByName);

// Détails d'une sous-catégorie avec ses produits
router.get('/sub-categories/:subCategoryName', categoriesController.getSubCategoryByName);

module.exports = router;
