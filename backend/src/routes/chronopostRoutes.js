const express = require('express');
const router = express.Router();
const c = require('../controllers/chronopostController');

router.post('/analyze',      ...c.analyze);
router.post('/export-excel', ...c.exportExcel);
router.post('/save',              ...c.saveInvoice);
router.post('/import-zip',        ...c.importZip);
router.post('/apply-tariffs',     c.applyTariffs);
router.get('/history',            c.getHistory);
router.get('/history/:id',        c.getInvoiceDetail);
router.get('/history/:id/pdf',    c.downloadPdf);
router.delete('/history/:id',     c.deleteInvoice);
router.post('/debug-text',   ...c.debugText);

// Avoirs (credit notes)
router.post('/analyze-credit',     ...c.analyzeCredit);
router.post('/save-credit',        ...c.saveCredit);
router.get('/credits',             c.getCreditsHistory);
router.get('/credits-for-orders',  c.getCreditsForOrders);
router.delete('/credits/:number',  c.deleteCredit);
router.get('/credits/:number/pdf', c.downloadCreditPdf);

router.get('/search-order', c.searchOrder);
router.get('/totals', c.getTotals);

module.exports = router;
