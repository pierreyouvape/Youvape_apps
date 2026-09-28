const express = require('express');
const router = express.Router();
const packingController = require('../controllers/packingController');
const pickingController = require('../controllers/pickingController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

// Rechercher une commande par numéro WC
router.get('/orders/:orderNumber', checkPackingRead, packingController.searchOrder);

// Lookup un barcode
router.get('/barcode/:barcode', checkPackingRead, packingController.lookupBarcode);

// Mettre à jour l'adresse de livraison d'une commande (correction préparateur)
router.put('/orders/:orderNumber/shipping', checkPackingRead, packingController.updateShipping);

// Picking (lot 4) : vague, manquants et tickets de la commande scannée, et les
// deux sorties d'une commande incomplète. Droit packing : ce sont les
// emballeurs qui s'en servent.
router.get('/orders/:orderNumber/picking', checkPackingRead, pickingController.packingInfo);
router.post('/orders/:orderNumber/incomplete', checkPackingRead, pickingController.packingIncomplete);
router.post('/orders/:orderNumber/set-aside', checkPackingRead, pickingController.packingSetAside);

module.exports = router;
