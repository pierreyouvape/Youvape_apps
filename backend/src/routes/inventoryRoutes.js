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

module.exports = router;
