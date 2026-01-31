const purchaseOrderModel = require('../models/purchaseOrderModel');
const needsCalculationModel = require('../models/needsCalculationModel');
const productAlertModel = require('../models/productAlertModel');

const purchasesController = {
  // ==================== BESOINS ====================

  // GET /api/purchases/needs
  getProductsNeeds: async (req, res) => {
    try {
      const filters = {
        supplier_id: req.query.supplier_id ? parseInt(req.query.supplier_id) : null,
        zero_stock: req.query.zero_stock === 'true',
        search: req.query.search || null,
        analysis_period_months: req.query.analysis_period ? parseFloat(req.query.analysis_period) : (req.query.analysis_period_months ? parseFloat(req.query.analysis_period_months) : 1),
        coverage_months: req.query.coverage_months ? parseFloat(req.query.coverage_months) : 1,
        limit: req.query.limit ? parseInt(req.query.limit) : 50,
        offset: req.query.offset ? parseInt(req.query.offset) : 0
      };

      const [products, total] = await Promise.all([
        needsCalculationModel.getAllProductsNeeds(filters),
        needsCalculationModel.countProducts(filters)
      ]);

      res.json({
        success: true,
        data: products,
        pagination: {
          total,
          limit: filters.limit,
          offset: filters.offset,
          pages: Math.ceil(total / filters.limit)
        }
      });
    } catch (error) {
      console.error('Erreur getProductsNeeds:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // GET /api/purchases/needs/:productId
  getProductNeed: async (req, res) => {
    try {
      const productId = parseInt(req.params.productId);
      const analysisPeriodMonths = req.query.analysis_period_months ? parseInt(req.query.analysis_period_months) : 1;
      const coverageMonths = req.query.coverage_months ? parseFloat(req.query.coverage_months) : 1;

      const needs = await needsCalculationModel.calculateProductNeeds(
        productId,
        analysisPeriodMonths,
        coverageMonths
      );

      res.json({ success: true, data: needs });
    } catch (error) {
      console.error('Erreur getProductNeed:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // ==================== ALERTES ====================

  // GET /api/purchases/alerts
  getAlerts: async (req, res) => {
    try {
      const alerts = await productAlertModel.getAll();
      res.json({ success: true, data: alerts });
    } catch (error) {
      console.error('Erreur getAlerts:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // PUT /api/purchases/alerts/:productId
  setAlert: async (req, res) => {
    try {
      const { alert_threshold, notes } = req.body;
      if (alert_threshold === undefined) {
        return res.status(400).json({ success: false, error: 'alert_threshold requis' });
      }

      const alert = await productAlertModel.upsert(
        req.params.productId,
        alert_threshold,
        notes
      );

      res.json({ success: true, data: alert });
    } catch (error) {
      console.error('Erreur setAlert:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // DELETE /api/purchases/alerts/:productId
  deleteAlert: async (req, res) => {
    try {
      const result = await productAlertModel.delete(req.params.productId);
      if (!result) {
        return res.status(404).json({ success: false, error: 'Alerte non trouvée' });
      }
      res.json({ success: true, message: 'Alerte supprimée' });
    } catch (error) {
      console.error('Erreur deleteAlert:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // ==================== COMMANDES ====================

  // GET /api/purchases/orders
  getOrders: async (req, res) => {
    try {
      const filters = {
        supplier_id: req.query.supplier_id ? parseInt(req.query.supplier_id) : null,
        status: req.query.status || null,
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        limit: req.query.limit ? parseInt(req.query.limit) : 50
      };

      const orders = await purchaseOrderModel.getAll(filters);
      res.json({ success: true, data: orders });
    } catch (error) {
      console.error('Erreur getOrders:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // GET /api/purchases/orders/:id
  getOrderById: async (req, res) => {
    try {
      const order = await purchaseOrderModel.getById(req.params.id);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Commande non trouvée' });
      }
      res.json({ success: true, data: order });
    } catch (error) {
      console.error('Erreur getOrderById:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // POST /api/purchases/orders
  createOrder: async (req, res) => {
    try {
      const { supplier_id, items } = req.body;

      if (!supplier_id) {
        return res.status(400).json({ success: false, error: 'supplier_id requis' });
      }

      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ success: false, error: 'items requis (liste non vide)' });
      }

      const order = await purchaseOrderModel.create(req.body, req.user.id);
      res.status(201).json({ success: true, data: order });
    } catch (error) {
      console.error('Erreur createOrder:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // PUT /api/purchases/orders/:id/status
  updateOrderStatus: async (req, res) => {
    try {
      const { status, order_date, expected_date, notes } = req.body;

      if (!status) {
        return res.status(400).json({ success: false, error: 'status requis' });
      }

      const validStatuses = ['draft', 'sent', 'confirmed', 'shipped', 'partial', 'received', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          error: `Statut invalide. Valeurs acceptées: ${validStatuses.join(', ')}`
        });
      }

      const order = await purchaseOrderModel.updateStatus(req.params.id, status, {
        order_date,
        expected_date,
        notes
      });

      if (!order) {
        return res.status(404).json({ success: false, error: 'Commande non trouvée' });
      }

      res.json({ success: true, data: order });
    } catch (error) {
      console.error('Erreur updateOrderStatus:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // PUT /api/purchases/orders/:id/items/:itemId/received
  updateItemReceived: async (req, res) => {
    try {
      const { qty_received } = req.body;

      if (qty_received === undefined) {
        return res.status(400).json({ success: false, error: 'qty_received requis' });
      }

      const order = await purchaseOrderModel.updateReceivedQty(
        req.params.id,
        req.params.itemId,
        qty_received
      );

      res.json({ success: true, data: order });
    } catch (error) {
      console.error('Erreur updateItemReceived:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // DELETE /api/purchases/orders/:id
  deleteOrder: async (req, res) => {
    try {
      const order = await purchaseOrderModel.delete(req.params.id);
      if (!order) {
        return res.status(400).json({
          success: false,
          error: 'Commande non trouvée ou impossible à supprimer (seuls les brouillons peuvent être supprimés)'
        });
      }
      res.json({ success: true, message: 'Commande supprimée' });
    } catch (error) {
      console.error('Erreur deleteOrder:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // ==================== EXPORT CSV ====================

  // GET /api/purchases/orders/:id/export
  exportOrder: async (req, res) => {
    try {
      const format = req.query.format || 'supplier'; // 'supplier' ou 'warehouse'
      const order = await purchaseOrderModel.getById(req.params.id);

      if (!order) {
        return res.status(404).json({ success: false, error: 'Commande non trouvée' });
      }

      let csvContent;
      let filename;

      if (format === 'warehouse') {
        // Format pour le logiciel de gestion de stock
        csvContent = purchasesController.generateWarehouseCSV(order);
        filename = `warehouse_${order.order_number}.csv`;
      } else {
        // Format fournisseur (utilise le mapping du fournisseur si disponible)
        csvContent = purchasesController.generateSupplierCSV(order);
        filename = `supplier_${order.order_number}.csv`;
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send('\uFEFF' + csvContent); // BOM pour Excel
    } catch (error) {
      console.error('Erreur exportOrder:', error);
      res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
  },

  // Génération CSV format fournisseur
  generateSupplierCSV: (order) => {
    const headers = ['Référence', 'Produit', 'Quantité', 'Prix unitaire', 'Total'];
    const rows = order.items.map(item => [
      item.supplier_sku || item.product_sku || '',
      item.product_name,
      item.qty_ordered,
      item.unit_price || '',
      item.unit_price ? (item.qty_ordered * item.unit_price).toFixed(2) : ''
    ]);

    const csv = [
      `Commande: ${order.order_number}`,
      `Fournisseur: ${order.supplier_name}`,
      `Date: ${new Date(order.created_at).toLocaleDateString('fr-FR')}`,
      '',
      headers.join(';'),
      ...rows.map(row => row.join(';')),
      '',
      `Total articles: ${order.total_items}`,
      `Total quantité: ${order.total_qty}`,
      order.total_amount > 0 ? `Total montant: ${order.total_amount.toFixed(2)} €` : ''
    ];

    return csv.join('\n');
  },

  // Génération CSV format warehouse
  generateWarehouseCSV: (order) => {
    const headers = ['SKU', 'Nom', 'Quantité', 'Fournisseur', 'Numéro commande'];
    const rows = order.items.map(item => [
      item.product_sku || '',
      item.product_name,
      item.qty_ordered,
      order.supplier_code || order.supplier_name,
      order.order_number
    ]);

    return [headers.join(';'), ...rows.map(row => row.join(';'))].join('\n');
  }
};

module.exports = purchasesController;
