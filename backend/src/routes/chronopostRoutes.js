const express = require('express');
const router = express.Router();
const chronopostController = require('../controllers/chronopostController');

// POST /api/chronopost/analyze  — analyse le PDF et retourne le JSON
router.post('/analyze', ...chronopostController.analyze);

// POST /api/chronopost/export-excel  — génère et télécharge le fichier Excel
router.post('/export-excel', ...chronopostController.exportExcel);
router.post('/debug-text', ...chronopostController.debugText);

module.exports = router;
