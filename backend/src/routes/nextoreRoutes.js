/**
 * Boutiques physiques (Nextore) — routeur, monté sur /api/nextore.
 * JWT + permission par boutique ('boutique-mtp' / 'boutique-cast').
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const nextoreController = require('../controllers/nextoreController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');
const { resolveWarehouse } = require('../config/nextore');

router.use(authMiddleware);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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
// Création d'un achat (en attente) dans Nextore depuis les Besoins
router.post('/:shop/purchases', boutiquePerm('write'), nextoreController.postPurchase);

// Import d'une commande fournisseur (PDF/CSV, parseurs du site) → achat en attente
router.get('/:shop/import/suppliers', boutiquePerm('read'), nextoreController.getImportSuppliers);
router.post('/:shop/import/parse', boutiquePerm('write'), upload.single('pdf'), nextoreController.postImportParse);
router.post('/:shop/import/map-line', boutiquePerm('write'), nextoreController.postImportMapLine);
router.post('/:shop/import/purchase', boutiquePerm('write'), nextoreController.postImportPurchase);

// Réception des commandes boutique → achat REÇU dans Nextore à la validation
router.get('/:shop/reception/orders', boutiquePerm('read'), nextoreController.getReceptionOrders);
router.post('/:shop/reception/orders', boutiquePerm('write'), nextoreController.postReceptionOrder);
router.get('/:shop/reception/costs', boutiquePerm('read'), nextoreController.getReceptionCosts);
router.get('/:shop/reception/orders/:id', boutiquePerm('read'), nextoreController.getReceptionOrder);
router.put('/:shop/reception/orders/:id', boutiquePerm('write'), nextoreController.putReceptionOrder);
router.delete('/:shop/reception/orders/:id', boutiquePerm('write'), nextoreController.deleteReceptionOrder);
router.post('/:shop/reception/orders/:id/session', boutiquePerm('write'), nextoreController.postReceptionSession);
router.put('/:shop/reception/sessions/:sessionId/counts/:itemId', boutiquePerm('write'), nextoreController.putReceptionCount);
router.post('/:shop/reception/sessions/:sessionId/lines', boutiquePerm('write'), nextoreController.postReceptionLine);
router.post('/:shop/reception/sessions/:sessionId/abandon', boutiquePerm('write'), nextoreController.postReceptionAbandon);
router.post('/:shop/reception/sessions/:sessionId/validate', boutiquePerm('write'), nextoreController.postReceptionValidate);
router.post('/:shop/reception/barcodes', boutiquePerm('write'), nextoreController.postReceptionBarcode);

// Historique (évolution) du stock d'un produit dans une boutique
router.get('/:shop/stock/:productId/history', boutiquePerm('read'), nextoreController.getStockHistory);

// Catégories + sous-catégories + marques (facettes du comptage)
router.get('/:shop/categories', boutiquePerm('read'), nextoreController.getCategories);
// Recherche produit (pour construire une liste de comptage manuelle)
router.get('/:shop/products/search', boutiquePerm('read'), nextoreController.searchProducts);

// Comptage (inventaire) — écriture Nextore : count/validate en permission 'write'
router.get('/:shop/comptages', boutiquePerm('read'), nextoreController.listComptages);
router.post('/:shop/comptage', boutiquePerm('write'), nextoreController.createComptage);
router.get('/:shop/comptage/:id', boutiquePerm('read'), nextoreController.getComptage);
router.post('/:shop/comptage/:id/count', boutiquePerm('write'), nextoreController.countComptage);
router.post('/:shop/comptage/:id/validate', boutiquePerm('write'), nextoreController.validateComptage);

module.exports = router;
