const express = require('express');
const router = express.Router();
const laposteController = require('../controllers/laposteController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

// Générer une étiquette Lettre Suivie pour une commande
router.post('/label/:orderNumber', checkPackingRead, laposteController.generateLabel);

// Lister les étiquettes
router.get('/labels', checkPackingRead, laposteController.listLabels);

// Annuler une étiquette
router.post('/labels/:id/cancel', checkPackingRead, laposteController.cancelLabel);

module.exports = router;
