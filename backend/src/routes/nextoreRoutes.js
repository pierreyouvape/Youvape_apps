/**
 * Boutiques physiques (Nextore) — routeur, monté sur /api/nextore.
 * JWT + permission par boutique ('boutique-mtp' / 'boutique-cast').
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const nextoreController = require('../controllers/nextoreController');
const prelevementController = require('../controllers/prelevementController');
const catalogController = require('../controllers/catalogController');
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
// Onglet Produits : fiche, et désactivation (boutique par boutique)
router.post('/:shop/products/disabled', boutiquePerm('write'), nextoreController.postProductsDisabled);
router.get('/:shop/products/:productId', boutiquePerm('read'), nextoreController.getProduct);

// Comptage (inventaire) — écriture Nextore : count/validate en permission 'write'
router.get('/:shop/comptages', boutiquePerm('read'), nextoreController.listComptages);
router.post('/:shop/comptage', boutiquePerm('write'), nextoreController.createComptage);
router.get('/:shop/comptage/:id', boutiquePerm('read'), nextoreController.getComptage);
router.post('/:shop/comptage/:id/count', boutiquePerm('write'), nextoreController.countComptage);
router.post('/:shop/comptage/:id/validate', boutiquePerm('write'), nextoreController.validateComptage);
router.post('/:shop/comptage/:id/abandon', boutiquePerm('write'), nextoreController.abandonComptage);

// Prélèvements au stock du site (Castelnau, EMC → EMC2) — prelevementController.
// Les vendeurs de Castelnau sont les gens du PDA (décision Maxime, 10/11/2026) :
// le droit picking (celui du PDA) suffit, en plus du droit de la boutique.
const userPermissionsModel = require('../models/userPermissionsModel');
const prelevementPerm = (action) => async (req, res, next) => {
  try {
    const wh = resolveWarehouse(req.params.shop);
    if (!wh) return res.status(400).json({ error: 'Boutique inconnue.' });
    if (userPermissionsModel.isSuperAdmin(req.user.email)
      || await userPermissionsModel.hasPermission(req.user.id, wh.permKey, action)
      || await userPermissionsModel.hasPermission(req.user.id, 'picking', 'read')) return next();
    return res.status(403).json({ error: 'Accès refusé : droit PDA ou boutique requis' });
  } catch (error) {
    console.error('Permission prélèvements:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
};
router.get('/:shop/prelevements', prelevementPerm('read'), prelevementController.list);
router.get('/:shop/prelevements/export', prelevementPerm('read'), prelevementController.exportCsv);
router.get('/:shop/prelevements/lookup', prelevementPerm('read'), prelevementController.lookup);
router.get('/:shop/prelevements/nextore-search', prelevementPerm('read'), prelevementController.searchNextore);
router.get('/:shop/prelevements/categories', prelevementPerm('read'), nextoreController.getCategories);
router.get('/:shop/prelevements/products/:productId', prelevementPerm('read'), prelevementController.product);
router.post('/:shop/prelevements', prelevementPerm('write'), prelevementController.create);
router.post('/:shop/prelevements/products/:productId/link', prelevementPerm('write'), prelevementController.link);
router.post('/:shop/prelevements/products/:productId/create-nextore', prelevementPerm('write'), prelevementController.createInNextore);
router.post('/:shop/prelevements/:id/resolve', prelevementPerm('write'), prelevementController.resolveStep);

// Catalogue caisse : produits du site → Nextore (catalogController). Droit de la boutique.
router.get('/:shop/catalogue/reviews', boutiquePerm('read'), catalogController.reviews);
router.get('/:shop/catalogue/categories', boutiquePerm('read'), nextoreController.getCategories);
router.get('/:shop/catalogue/nextore-search', boutiquePerm('read'), catalogController.searchNextore);
router.get('/:shop/catalogue/products/:productId', boutiquePerm('read'), catalogController.product);
router.post('/:shop/catalogue/products/:productId/link', boutiquePerm('write'), catalogController.link);
router.post('/:shop/catalogue/products/:productId/create-nextore', boutiquePerm('write'), catalogController.createInNextore);
router.post('/:shop/catalogue/reviews/:id/ignore', boutiquePerm('write'), catalogController.ignore);
router.post('/:shop/catalogue/prices/align', boutiquePerm('write'), catalogController.alignPrices);
router.post('/:shop/catalogue/prices/keep', boutiquePerm('write'), catalogController.keepPrices);
router.post('/:shop/catalogue/run', boutiquePerm('write'), catalogController.run);

module.exports = router;
