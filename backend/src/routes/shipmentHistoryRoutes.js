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
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

const checkPackingRead = checkPermission('packing', 'read');

router.get('/', checkPackingRead, shipmentHistoryController.list);
router.get('/:id', checkPackingRead, shipmentHistoryController.detail);

module.exports = router;
