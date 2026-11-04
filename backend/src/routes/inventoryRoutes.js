const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const c = require('../controllers/inventoryController');

router.use(authMiddleware);

// PDA : comme les autres apps PDA, le droit Picking suffit (décision Pierre
// du 05/10/2026, confirmée pour l'inventaire le 06/10).
const pda = express.Router();
pda.use(checkPermission('picking', 'read'));
pda.get('/current', c.current);
pda.get('/locations/find', c.findLocation);
pda.get('/locations/:locationId', c.getLocation);
pda.post('/locations/:locationId/take', c.take);
pda.post('/locations/:locationId/scan', c.scan);
pda.put('/locations/:locationId/products/:productId', c.setQty);
pda.delete('/locations/:locationId/products/:productId', c.removeLine);
pda.post('/locations/:locationId/close', c.close);
pda.post('/locations/:locationId/reopen', c.reopen);
pda.post('/pack-quantity', c.packQuantity);
pda.post('/validate-day', c.validateDay);
pda.get('/recounts', c.listRecounts);
pda.get('/recounts/:itemId', c.getRecount);
pda.post('/recounts/:itemId/take', c.takeRecount);
pda.post('/recounts/:itemId/scan', c.scanRecount);
pda.put('/recounts/:itemId', c.setRecountQty);
pda.post('/recounts/:itemId/finish', c.finishRecount);
// Inventaire par emplacement (04/11/2026) : créé au PC ou ici.
pda.post('/spot', c.spotCreate);
pda.get('/spot/:id', c.spotHome);
pda.post('/spot/:id/passes', c.spotOpen);
pda.get('/spot-passes/:passId', c.spotGet);
pda.post('/spot-passes/:passId/scan', c.spotScan);
pda.post('/spot-passes/:passId/add', c.spotAdd);
pda.put('/spot-passes/:passId/lines/:lineId', c.spotSetQty);
pda.post('/spot-passes/:passId/lines/:lineId/move', c.spotMove);
pda.delete('/spot-passes/:passId/lines/:lineId', c.spotRemove);
pda.post('/spot-passes/:passId/validate', c.spotValidate);
pda.post('/spot-passes/:passId/abandon', c.spotAbandonMine);
router.use('/pda', pda);

// PC : droit propre `inventaire` (création, suivi, libérations).
const read = checkPermission('inventaire', 'read');
const write = checkPermission('inventaire', 'write');
router.get('/options', read, c.options);
router.post('/preview', read, c.preview);
router.get('/', read, c.list);
router.post('/', write, c.create);
router.get('/:id', read, c.get);
router.post('/:id/locations/:locationId/release', write, c.releaseLocation);
router.post('/:id/recounts/:itemId/release', write, c.releaseRecount);
router.post('/:id/cancel', write, c.cancel);
// Lot 2 : écarts, envoi à BMS, emplacement, clôture.
router.get('/:id/gaps', read, c.gaps);
router.post('/:id/gaps/send', write, c.sendGaps);
router.post('/:id/gaps/retry', write, c.retryGaps);
router.post('/:id/gaps/ignore', write, c.ignoreGaps);
router.post('/:id/gaps/unignore', write, c.unignoreGaps);
router.post('/:id/items/:itemId/recount', write, c.requestRecount);
router.post('/:id/items/:itemId/location', write, c.fixLocation);
router.post('/:id/close', write, c.closeInventory);
// Inventaire par emplacement.
router.post('/:id/spot-passes/:passId/abandon', write, c.spotAbandon);
router.post('/:id/spot-lines/retry', write, c.spotRetry);
router.post('/:id/spot-lines/ignore', write, c.spotIgnore);

module.exports = router;
