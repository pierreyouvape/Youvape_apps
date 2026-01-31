const supplierModel = require('../models/supplierModel');

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
      const { product_id, is_primary, supplier_sku, supplier_price, min_order_qty } = req.body;
      if (!product_id) {
        return res.status(400).json({ success: false, error: 'product_id requis' });
      }

      const result = await supplierModel.addProduct(req.params.id, product_id, {
        is_primary,
        supplier_sku,
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
  }
};

module.exports = suppliersController;
