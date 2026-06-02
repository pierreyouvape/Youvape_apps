const express = require('express');
const router = express.Router();
const colissimoController = require('../controllers/colissimoController');

router.post('/analyze',      ...colissimoController.analyze);
router.post('/export-excel', ...colissimoController.exportExcel);
router.post('/debug-text',   ...colissimoController.debugText);

module.exports = router;
