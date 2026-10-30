const express = require('express');
const router = express.Router();
const { checkAdmin } = require('../middleware/permissionMiddleware');
const pluginLogistiqueController = require('../controllers/pluginLogistiqueController');

// Réglages du plugin WordPress youvape-logistique (Paramètres généraux, onglet
// Paramètres WooCommerce). Réservés aux admins : ils décident quels statuts de
// commande le plugin peut changer sans mail, et quelles métas il écrit.
router.use(checkAdmin);

router.get('/', pluginLogistiqueController.getPluginLogistique);
router.put('/connection', pluginLogistiqueController.savePluginLogistiqueConnection);
router.post('/settings', pluginLogistiqueController.updatePluginLogistiqueSettings);

module.exports = router;
