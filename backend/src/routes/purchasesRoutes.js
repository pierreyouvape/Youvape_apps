const express = require('express');
const router = express.Router();
const suppliersController = require('../controllers/suppliersController');
const purchasesController = require('../controllers/purchasesController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Toutes les routes sont protégées par le middleware JWT
router.use(authMiddleware);

// Middleware pour vérifier les permissions
const checkPurchasesRead = checkPermission('purchases', 'read');
const checkPurchasesWrite = checkPermission('purchases', 'write');

// ==================== FOURNISSEURS ====================

// Liste des fournisseurs
router.get('/suppliers', checkPurchasesRead, suppliersController.getAllSuppliers);

// Détail d'un fournisseur
router.get('/suppliers/:id', checkPurchasesRead, suppliersController.getSupplierById);

// Créer un fournisseur
router.post('/suppliers', checkPurchasesWrite, suppliersController.createSupplier);

// Modifier un fournisseur
router.put('/suppliers/:id', checkPurchasesWrite, suppliersController.updateSupplier);

// Supprimer un fournisseur
router.delete('/suppliers/:id', checkPurchasesWrite, suppliersController.deleteSupplier);

// Produits d'un fournisseur
router.get('/suppliers/:id/products', checkPurchasesRead, suppliersController.getSupplierProducts);

// Associer un produit à un fournisseur
router.post('/suppliers/:id/products', checkPurchasesWrite, suppliersController.addProductToSupplier);

// Retirer un produit d'un fournisseur
router.delete('/suppliers/:id/products/:productId', checkPurchasesWrite, suppliersController.removeProductFromSupplier);

// Import CSV de fournisseurs
router.post('/suppliers/import', checkPurchasesWrite, suppliersController.importSuppliers);

// ==================== PRODUITS / FOURNISSEURS ====================

// Fournisseurs d'un produit
router.get('/products/:productId/suppliers', checkPurchasesRead, suppliersController.getProductSuppliers);

// Définir le fournisseur principal d'un produit
router.put('/products/:productId/primary-supplier', checkPurchasesWrite, suppliersController.setPrimarySupplier);

// ==================== BESOINS ====================

// Liste des besoins (tous les produits avec calculs)
router.get('/needs', checkPurchasesRead, purchasesController.getProductsNeeds);

// Besoin d'un produit spécifique
router.get('/needs/:productId', checkPurchasesRead, purchasesController.getProductNeed);

// ==================== ALERTES ====================

// Liste des alertes
router.get('/alerts', checkPurchasesRead, purchasesController.getAlerts);

// Définir/modifier une alerte
router.put('/alerts/:productId', checkPurchasesWrite, purchasesController.setAlert);

// Supprimer une alerte
router.delete('/alerts/:productId', checkPurchasesWrite, purchasesController.deleteAlert);

// ==================== COMMANDES ====================

// Liste des commandes
router.get('/orders', checkPurchasesRead, purchasesController.getOrders);

// Détail d'une commande
router.get('/orders/:id', checkPurchasesRead, purchasesController.getOrderById);

// Créer une commande
router.post('/orders', checkPurchasesWrite, purchasesController.createOrder);

// Modifier le statut d'une commande
router.put('/orders/:id/status', checkPurchasesWrite, purchasesController.updateOrderStatus);

// Modifier la quantité reçue d'une ligne
router.put('/orders/:id/items/:itemId/received', checkPurchasesWrite, purchasesController.updateItemReceived);

// Supprimer une commande (brouillon uniquement)
router.delete('/orders/:id', checkPurchasesWrite, purchasesController.deleteOrder);

// Export CSV d'une commande
router.get('/orders/:id/export', checkPurchasesRead, purchasesController.exportOrder);

module.exports = router;
