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

// Prévision d'achat (besoins) : ?period=&seuil=&coverage=&supplier=
router.get('/:shop/needs', boutiquePerm('read'), nextoreController.getNeeds);

// Fournisseurs de la boutique (pour le filtre des besoins)
router.get('/:shop/suppliers', boutiquePerm('read'), nextoreController.getSuppliers);

// Données brutes pour l'écran Besoins style V2 (calcul côté client)
router.get('/:shop/needs-data', boutiquePerm('read'), nextoreController.getNeedsData);

// Historique (évolution) du stock d'un produit dans une boutique
router.get('/:shop/stock/:productId/history', boutiquePerm('read'), nextoreController.getStockHistory);

// --- Rapprochement caisse <-> site ------------------------------------------
// Lecture de la file de validation + recherche de produits site
router.get('/:shop/match', boutiquePerm('read'), nextoreController.getMatches);
router.get('/:shop/match/search', boutiquePerm('read'), nextoreController.getWcSearch);
// Relance du moteur : ne fait que PROPOSER (tout reste en attente) → read suffit
router.post('/:shop/match/run', boutiquePerm('read'), nextoreController.postRunMatching);
// Arbitrage (valider / rejeter / rattacher) : modifie les coûts affichés → write
router.post('/:shop/match/bulk', boutiquePerm('write'), nextoreController.postMatchBulk);
router.patch('/:shop/match/:nxId', boutiquePerm('write'), nextoreController.patchMatch);

module.exports = router;
