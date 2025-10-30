const express = require('express');
const router = express.Router();
const testDataController = require('../controllers/testDataController');

// Génère et importe des données de test
router.post('/generate', testDataController.generateTestData);

// Récupère les offsets actuels
router.get('/offsets', testDataController.getOffsets);

// Reset les offsets à 0
router.delete('/offsets', testDataController.resetOffsets);

// Supprime toutes les données de test
router.delete('/data', testDataController.deleteAllTestData);

module.exports = router;
