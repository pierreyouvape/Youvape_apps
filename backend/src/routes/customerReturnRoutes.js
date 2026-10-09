const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const c = require('../controllers/customerReturnController');

// Retours client : mêmes droits que les tickets (décision Pierre du 09/10/2026).
router.use(authMiddleware);
const read = checkPermission('tickets', 'read');
const write = checkPermission('tickets', 'write');

router.get('/suppliers', read, c.supplierSummary);
router.get('/suppliers/:supplierId', read, c.supplierItems);
router.post('/suppliers/:supplierId/batches', write, c.createBatch);
router.get('/batches/:batchId/export', read, c.exportBatch);

router.get('/order/:wpOrderId', read, c.orderContext);
router.get('/', read, c.list);
router.post('/', write, c.create);
router.get('/:id', read, c.get);
router.post('/:id/validate', write, c.validate);
router.post('/:id/restock', write, c.restock);
router.post('/:id/treat', write, c.treat);
router.post('/:id/cancel', write, c.cancel);

module.exports = router;
