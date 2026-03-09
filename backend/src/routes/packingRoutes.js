const express = require('express');
const router = express.Router();
const packingController = require('../controllers/packingController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

// Rechercher une commande par numéro WC
router.get('/orders/:orderNumber', checkPackingRead, packingController.searchOrder);

// Lookup un barcode
router.get('/barcode/:barcode', checkPackingRead, packingController.lookupBarcode);

module.exports = router;
