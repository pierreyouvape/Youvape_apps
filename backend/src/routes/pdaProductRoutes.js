const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const pdaProductController = require('../controllers/pdaProductController');

router.use(authMiddleware);

// Décision Pierre (05/10/2026) : qui a le PDA a tout — pas de lecture / écriture
// séparées. L'accès suit le droit Picking, celui des préparateurs.
router.use(checkPermission('picking', 'read'));

router.get('/search', pdaProductController.search);
router.get('/locations', pdaProductController.locations);
router.get('/reasons', pdaProductController.reasons);
router.get('/products/:id', pdaProductController.get);
router.put('/products/:id/location', pdaProductController.setLocation);
router.post('/products/:id/barcodes', pdaProductController.addBarcode);
router.put('/products/:id/barcodes/:barcodeId', pdaProductController.editBarcode);
router.delete('/products/:id/barcodes/:barcodeId', pdaProductController.deleteBarcode);
router.post('/products/:id/movements', pdaProductController.createMovement);

module.exports = router;
