/**
 * Transferts de stock site ↔ boutiques — monté sur /api/transferts.
 * JWT + droit `transferts` (lecture pour consulter, écriture pour composer et envoyer).
 * La réception, elle, se fait là où elle se fait déjà : Boutique › Commandes
 * (droit de la boutique) ou app Réception (droit `reception`).
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const c = require('../controllers/stockTransferController');

router.use(authMiddleware);
const read = checkPermission('transferts', 'read');
const write = checkPermission('transferts', 'write');

router.get('/', read, c.list);
router.get('/export', read, c.exportCsv);
router.post('/', write, c.create);
router.get('/:id', read, c.get);
router.put('/:id', write, c.update);
router.post('/:id/cancel', write, c.cancel);
router.get('/:id/lookup', read, c.lookup);
router.put('/:id/lines/:productId', write, c.setLine);
router.post('/:id/send', write, c.send);
router.post('/:id/retry-order', write, c.retryOrder);
router.post('/:id/items/:itemId/resolve', write, c.resolveOut);

module.exports = router;
