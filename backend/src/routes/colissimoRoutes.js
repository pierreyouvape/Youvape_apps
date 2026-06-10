const express = require('express');
const router = express.Router();
const colissimoController = require('../controllers/colissimoController');

router.post('/analyze',      ...colissimoController.analyze);
router.post('/export-excel', ...colissimoController.exportExcel);
router.post('/save',              ...colissimoController.saveInvoice);
router.post('/apply-tariffs',     colissimoController.applyTariffs);
router.get('/history',            colissimoController.getHistory);
router.get('/history/:id',        colissimoController.getInvoiceDetail);
router.get('/history/:id/pdf',    colissimoController.downloadPdf);
router.delete('/history/:id',     colissimoController.deleteInvoice);
router.post('/debug-text',   ...colissimoController.debugText);
router.get('/search-order',  colissimoController.searchOrder);

module.exports = router;
