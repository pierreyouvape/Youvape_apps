/**
 * Historique d'expédition — app du groupe Prépa de commande.
 *
 * Droit `packing` en lecture, comme le bordereau (cf. bordereauRoutes.js) :
 * l'app n'a pas de clé de permission à elle, et le front dit la même chose
 * avec `permissionKey` dans `AppIcons.jsx`.
 */

const express = require('express');
const router = express.Router();
const shipmentHistoryController = require('../controllers/shipmentHistoryController');
const trackingController = require('../controllers/shipmentTrackingController');
const claimController = require('../controllers/carrierClaimController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

router.get('/', checkPackingRead, shipmentHistoryController.list);

// Réclamations Chronopost (contrôle de 16 h). Lancer un contrôle ou noter un
// import demande le packing en écriture : ça pose des notes dans le SAV.
const checkPackingWrite = checkPermission('packing', 'write');
router.get('/claims', checkPackingRead, claimController.list);
router.get('/claims/:batchId/file', checkPackingRead, claimController.download);
router.post('/claims/run', checkPackingWrite, claimController.run);
router.post('/claims/:batchId/import-report', checkPackingWrite, claimController.importReport);

// Colis emballé dans BMS : même fiche, sans action.
router.get('/bms/:id', checkPackingRead, shipmentHistoryController.detailBms);
router.get('/:id', checkPackingRead, shipmentHistoryController.detail);
// Réinterroge le transporteur pour ce colis, sans attendre le passage suivant.
router.post('/:id/tracking/refresh', checkPackingRead, trackingController.refresh);

module.exports = router;
