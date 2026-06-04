const express = require('express');
const router = express.Router();
const c = require('../controllers/chronopostController');

router.post('/analyze',      ...c.analyze);
router.post('/export-excel', ...c.exportExcel);
router.post('/save',         c.saveInvoice);
router.get('/history',       c.getHistory);
router.get('/history/:id',   c.getInvoiceDetail);
router.post('/debug-text',   ...c.debugText);

module.exports = router;
