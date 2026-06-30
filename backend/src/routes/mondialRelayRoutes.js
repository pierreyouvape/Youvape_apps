const express = require('express');
const router = express.Router();
const c = require('../controllers/mondialRelayController');

router.post('/analyze',        ...c.analyze);
router.post('/export-excel',   ...c.exportExcel);
router.post('/save',           ...c.saveInvoice);
router.post('/import-zip',     ...c.importZip);
router.get('/history',         c.getHistory);
router.get('/history/:id',     c.getInvoiceDetail);
router.get('/history/:id/pdf', c.downloadPdf);
router.delete('/history/:id',  c.deleteInvoice);
router.get('/totals',          c.getTotals);
router.post('/debug-text',     ...c.debugText);

module.exports = router;
