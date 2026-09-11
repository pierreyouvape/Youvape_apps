const supplierModel = require('../models/supplierModel');
const supplierRefModel = require('../models/supplierRefModel');

const sendRefError = (res, error, where) => {
  if (error.code === 'REF_TAKEN') {
    return res.status(409).json({
      success: false,
      code: 'REF_TAKEN',
      error: error.message,
      owner: {
        product_id: error.owner.product_id,
        wp_product_id: error.owner.wp_product_id,
        post_title: error.owner.post_title,
        sku: error.owner.sku,
      },
    });
  }
  console.error(`Erreur ${where}:`, error);
  res.status(500).json({ success: false, error: error.message || 'Erreur serveur' });
};

const suppliersController = {
  // GET /api/purchases/suppliers
  getAllSuppliers: async (req, res) => {
    try {
      const includeInactive = req.query.include_inactive === 'true';
      const suppliers = await supplierModel.getAll(includeInactive);
      res.json({ success: true, data: suppliers });
    } catch (error) {
      console.error('Erreur getAllSuppliers:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // GET /api/purchases/suppliers/:id
  getSupplierById: async (req, res) => {
    try {
      const supplier = await supplierModel.getById(req.params.id);
      if (!supplier) {
        return res.status(404).json({ success: false, error: 'Fournisseur non trouvé' });
      }
      res.json({ success: true, data: supplier });
    } catch (error) {
      console.error('Erreur getSupplierById:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // POST /api/purchases/suppliers
  createSupplier: async (req, res) => {
    try {
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: 'Le nom est requis' });
      }
      const supplier = await supplierModel.create(req.body);
      res.status(201).json({ success: true, data: supplier });
    } catch (error) {
      console.error('Erreur createSupplier:', error);
      if (error.code === '23505') { // Unique violation
        return res.status(400).json({ success: false, error: 'Ce code fournisseur existe déjà' });
      }
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // PUT /api/purchases/suppliers/:id
  updateSupplier: async (req, res) => {
    try {
      const supplier = await supplierModel.update(req.params.id, req.body);
      if (!supplier) {
        return res.status(404).json({ success: false, error: 'Fournisseur non trouvé' });
      }
      res.json({ success: true, data: supplier });
    } catch (error) {
      console.error('Erreur updateSupplier:', error);
      if (error.code === '23505') {
        return res.status(400).json({ success: false, error: 'Ce code fournisseur existe déjà' });
      }
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // DELETE /api/purchases/suppliers/:id
  deleteSupplier: async (req, res) => {
    try {
      const hardDelete = req.query.hard === 'true';
      const supplier = hardDelete
        ? await supplierModel.hardDelete(req.params.id)
        : await supplierModel.delete(req.params.id);

      if (!supplier) {
        return res.status(404).json({ success: false, error: 'Fournisseur non trouvé' });
      }
      res.json({ success: true, message: 'Fournisseur supprimé' });
    } catch (error) {
      console.error('Erreur deleteSupplier:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // GET /api/purchases/suppliers/:id/products
  getSupplierProducts: async (req, res) => {
    try {
      const products = await supplierModel.getProducts(req.params.id);
      res.json({ success: true, data: products });
    } catch (error) {
      console.error('Erreur getSupplierProducts:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // POST /api/purchases/suppliers/:id/products
  addProductToSupplier: async (req, res) => {
    try {
      const { product_id, is_primary, supplier_price, min_order_qty } = req.body;
      if (!product_id) {
        return res.status(400).json({ success: false, error: 'product_id requis' });
      }

      const result = await supplierModel.addProduct(req.params.id, product_id, {
        is_primary,
        supplier_price,
        min_order_qty
      });

      res.status(201).json({ success: true, data: result });
    } catch (error) {
      console.error('Erreur addProductToSupplier:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // DELETE /api/purchases/suppliers/:id/products/:productId
  removeProductFromSupplier: async (req, res) => {
    try {
      const result = await supplierModel.removeProduct(req.params.id, req.params.productId);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Association non trouvée' });
      }
      res.json({ success: true, message: 'Produit retiré du fournisseur' });
    } catch (error) {
      console.error('Erreur removeProductFromSupplier:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // PUT /api/purchases/products/:productId/primary-supplier
  setPrimarySupplier: async (req, res) => {
    try {
      const { supplier_id } = req.body;
      if (!supplier_id) {
        return res.status(400).json({ success: false, error: 'supplier_id requis' });
      }

      const result = await supplierModel.setPrimarySupplier(req.params.productId, supplier_id);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Association non trouvée' });
      }
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Erreur setPrimarySupplier:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // GET /api/purchases/products/:productId/suppliers
  getProductSuppliers: async (req, res) => {
    try {
      const suppliers = await supplierModel.getSuppliersByProduct(req.params.productId);
      res.json({ success: true, data: suppliers });
    } catch (error) {
      console.error('Erreur getProductSuppliers:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // ==================== RÉFS FOURNISSEUR ====================
  // Réf déjà portée par un autre produit → 409 REF_TAKEN avec ce produit : l'écran
  // demande confirmation puis rejoue la requête avec move = true (déplacement).

  // POST /api/purchases/supplier-refs  { supplier_id, product_id (id INTERNE), supplier_sku, label, pack_qty, pack_price, move }
  createSupplierRef: async (req, res) => {
    try {
      const { supplier_id, product_id, supplier_sku, label, pack_qty, pack_price, move } = req.body;
      if (!supplier_id || !product_id) {
        return res.status(400).json({ success: false, error: 'supplier_id et product_id requis' });
      }
      const result = await supplierRefModel.save({
        supplierId: supplier_id,
        productId: product_id,
        supplierSku: supplier_sku,
        label,
        packQty: pack_qty,
        packPrice: pack_price,
        move: !!move,
      });
      res.status(201).json({ success: true, data: result.ref, moved_from: result.movedFrom });
    } catch (error) {
      sendRefError(res, error, 'createSupplierRef');
    }
  },

  // PUT /api/purchases/supplier-refs/:refId  { supplier_sku, label, pack_qty, pack_price, move }
  updateSupplierRef: async (req, res) => {
    try {
      const { supplier_sku, label, pack_qty, pack_price, move } = req.body;
      const ref = await supplierRefModel.update(req.params.refId, {
        supplierSku: supplier_sku,
        label,
        packQty: pack_qty,
        packPrice: pack_price,
        move: !!move,
      });
      if (!ref) return res.status(404).json({ success: false, error: 'Réf. introuvable' });
      res.json({ success: true, data: ref });
    } catch (error) {
      sendRefError(res, error, 'updateSupplierRef');
    }
  },

  // DELETE /api/purchases/supplier-refs/:refId
  deleteSupplierRef: async (req, res) => {
    try {
      const ref = await supplierRefModel.remove(req.params.refId);
      if (!ref) return res.status(404).json({ success: false, error: 'Réf. introuvable' });
      res.json({ success: true, data: ref });
    } catch (error) {
      sendRefError(res, error, 'deleteSupplierRef');
    }
  },

  // POST /api/purchases/suppliers/import
  importSuppliers: async (req, res) => {
    try {
      const { suppliers } = req.body;
      if (!suppliers || !Array.isArray(suppliers) || suppliers.length === 0) {
        return res.status(400).json({ success: false, error: 'Liste de fournisseurs requise' });
      }

      const created = await supplierModel.bulkCreate(suppliers);
      res.status(201).json({
        success: true,
        message: `${created.length} fournisseur(s) importé(s)`,
        data: created
      });
    } catch (error) {
      console.error('Erreur importSuppliers:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // POST /api/purchases/suppliers/sync-bms
  syncFromBMS: async (req, res) => {
    try {
      console.log('Début sync fournisseurs BMS...');
      const result = await supplierModel.syncFromBMS();
      console.log(`Sync BMS terminée: ${result.created} créés, ${result.updated} mis à jour`);

      res.json({
        success: true,
        message: `Synchronisation terminée: ${result.created} créé(s), ${result.updated} mis à jour`,
        data: result
      });
    } catch (error) {
      console.error('Erreur syncFromBMS:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la synchronisation BMS',
        details: error.message
      });
    }
  },

  // POST /api/purchases/suppliers/sync-product-suppliers
  syncProductSuppliersFromBMS: async (req, res) => {
    try {
      console.log('Début sync associations produits-fournisseurs BMS...');
      const result = await supplierModel.syncProductSuppliersFromBMS();
      console.log(`Sync produits-fournisseurs terminée: ${result.linked} associations créées/mises à jour`);

      res.json({
        success: true,
        message: `Synchronisation terminée : ${result.linked} association(s) créées/mises à jour, ${result.skuNotFound} SKU non trouvés`,
        data: result
      });
    } catch (error) {
      console.error('Erreur syncProductSuppliersFromBMS:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la synchronisation des associations produits-fournisseurs',
        details: error.message
      });
    }
  }
};

module.exports = suppliersController;
