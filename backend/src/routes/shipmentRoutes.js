/**
 * Étiquetage d'expédition, tous transporteurs.
 *
 * À la différence de `/api/laposte/*`, qui est figé sur un transporteur, ces
 * routes déduisent le transporteur de la commande via
 * `shipping_method_carrier_map`. C'est la porte d'entrée du packing pour tout
 * ce qui n'est pas la lettre suivie historique.
 *
 * Deux niveaux de droit, volontairement différents :
 *   - **émettre une étiquette** : droit `packing` (les préparateurs) ;
 *   - **modifier la correspondance** : droit `transporteurs` en écriture, que
 *     seuls les responsables ont. C'est ce qui donne son sens au message
 *     « demandez à un responsable de l'ajouter » affiché au packing : la
 *     personne bloquée n'a pas le droit de se débloquer elle-même, et c'est
 *     voulu — un mauvais mappage envoie des colis chez le mauvais transporteur.
 */

const express = require('express');
const router = express.Router();
const shipmentController = require('../controllers/shipmentController');
const mapController = require('../controllers/shippingMethodMapController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

router.use(authMiddleware);

// ── Étiquetage ──────────────────────────────────────────────────────────────
// Le transporteur est choisi par la correspondance, pas par l'appelant.
router.post('/label/:orderNumber',
  checkPermission('packing', 'read'), shipmentController.generateForOrder);

// ── Réglages de la correspondance ───────────────────────────────────────────
router.get('/method-map',
  checkPermission('transporteurs', 'read'), mapController.getMap);

router.post('/method-map',
  checkPermission('transporteurs', 'write'), mapController.saveMapping);

router.delete('/method-map/:id',
  checkPermission('transporteurs', 'write'), mapController.deleteMapping);

// ── Contrats transporteurs ──────────────────────────────────────────────────
// Les identifiants d'API se saisissent ici, jamais en dur ni par SQL. La
// lecture ne rend jamais les secrets : voir models/carrierAccountModel.
router.get('/carrier-accounts',
  checkPermission('transporteurs', 'read'), mapController.getAccounts);

router.post('/carrier-accounts',
  checkPermission('transporteurs', 'write'), mapController.saveAccount);

router.delete('/carrier-accounts/:id',
  checkPermission('transporteurs', 'write'), mapController.deleteAccount);

module.exports = router;
