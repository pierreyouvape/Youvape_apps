const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const pickingController = require('../controllers/pickingController');
const packingController = require('../controllers/packingController');

router.use(authMiddleware);

// Lecture : voir les commandes et les vagues (et, au lot 3, picker au PDA).
// Écriture : créer / annuler des vagues, bloquer, corriger, régler.
const canRead = checkPermission('picking', 'read');
const canWrite = checkPermission('picking', 'write');

router.get('/orders', canRead, pickingController.listOrders);
router.post('/refresh', canRead, pickingController.refresh);
router.post('/orders/:orderNumber/block', canWrite, pickingController.block);
router.delete('/orders/:orderNumber/block', canWrite, pickingController.unblock);
router.get('/orders/:orderNumber/correction', canWrite, pickingController.getCorrection);
// Même correction d'adresse que le packing, avec le droit du picking.
router.put('/orders/:orderNumber/shipping', canWrite, packingController.updateShipping);

router.get('/rules', canRead, pickingController.listRules);
router.post('/rules', canWrite, pickingController.saveRule);
router.put('/rules/:id', canWrite, pickingController.saveRule);
router.delete('/rules/:id', canWrite, pickingController.deleteRule);
router.put('/settings/manual-prefix', canWrite, pickingController.setManualPrefix);

router.get('/waves', canRead, pickingController.listWaves);
router.get('/waves/preview', canWrite, pickingController.previewGeneration);
router.post('/waves/pdf', canRead, pickingController.printWaves);
router.post('/waves/generate', canWrite, pickingController.generate);
router.post('/waves/manual', canWrite, pickingController.createManualWave);
router.get('/waves/:id', canRead, pickingController.getWave);
// Imprimer fait partie de la préparation : le droit de lecture suffit.
router.get('/waves/:id/pdf', canRead, pickingController.printWave);
router.post('/waves/:id/cancel', canWrite, pickingController.cancelWave);

router.post('/waves/:id/release', canWrite, pickingController.releaseWave);

// PDA : le droit de lecture suffit — c'est le travail du préparateur.
router.get('/pda/waves', canRead, pickingController.pdaListWaves);
router.get('/pda/waves/find', canRead, pickingController.pdaFindWave);
router.get('/pda/waves/:id', canRead, pickingController.pdaGetWave);
router.post('/pda/waves/:id/assign', canRead, pickingController.pdaAssign);
router.post('/pda/waves/:id/scan', canRead, pickingController.pdaScan);
router.post('/pda/waves/:id/lines/:lineId/validate', canRead, pickingController.pdaValidate);
router.post('/pda/waves/:id/lines/:lineId/missing', canRead, pickingController.pdaMissing);
router.post('/pda/waves/:id/lines/:lineId/undo', canRead, pickingController.pdaUndo);
router.post('/pda/waves/:id/finish', canRead, pickingController.pdaFinish);

module.exports = router;
