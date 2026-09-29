/**
 * Stats d'expédition — app du groupe Prépa de commande.
 *
 * Droit PROPRE `stats-expedition`, pas `packing` (décision de Pierre,
 * 29/09/2026) : l'app montre les performances de chacun, les préparateurs n'ont
 * pas à voir celles de leurs collègues.
 */

const express = require('express');
const router = express.Router();
const shipmentStatsController = require('../controllers/shipmentStatsController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

router.get('/', checkPermission('stats-expedition', 'read'), shipmentStatsController.get);

module.exports = router;
