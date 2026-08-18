/**
 * Boutiques physiques (Nextore) — routeur, monté sur /api/nextore.
 * JWT + permission par boutique ('boutique-mtp' / 'boutique-cast').
 */

const express = require('express');
const router = express.Router();
const nextoreController = require('../controllers/nextoreController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { resolveWarehouse } = require('../config/nextore');

router.use(authMiddleware);

/**
 * Permission dynamique selon la boutique (:shop). Résout le warehouse depuis
 * l'URL puis délègue au checkPermission de la clé correspondante.
 */
const boutiquePerm = (action) => (req, res, next) => {
  const wh = resolveWarehouse(req.params.shop);
  if (!wh) {
    return res.status(400).json({ error: `Boutique inconnue : "${req.params.shop}" (attendu montpellier|castelnau ou 1|2)` });
  }
  return checkPermission(wh.permKey, action)(req, res, next);
};

// Synchro (catalogue + stock des 2 boutiques + snapshot). Déclenchée depuis une
// vue boutique : accès en lecture sur cette boutique suffit (refresh du miroir).
router.post('/:shop/sync', boutiquePerm('read'), nextoreController.postSync);

// Relevé de stock d'une boutique (:shop = montpellier|castelnau ou 1|2)
router.get('/:shop/stock', boutiquePerm('read'), nextoreController.getStock);

// Historique (évolution) du stock d'un produit dans une boutique
router.get('/:shop/stock/:productId/history', boutiquePerm('read'), nextoreController.getStockHistory);

module.exports = router;
