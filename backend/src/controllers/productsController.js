const productModel = require('../models/productModel');
const advancedFilterService = require('../services/advancedFilterService');

/**
 * Récupère tous les produits
 * GET /api/products
 */
exports.getAll = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const products = await productModel.getAll(limit, offset);
    const total = await productModel.count();

    res.json({
      success: true,
      data: products,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    });
  } catch (error) {
    console.error('Error getting products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère un produit par ID
 * GET /api/products/:id
 */
exports.getById = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const product = await productModel.getById(productId);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error getting product:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recherche simple de produits
 * GET /api/products/search?q=fraise
 */
exports.search = async (req, res) => {
  try {
    const searchTerm = req.query.q || '';
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const products = await productModel.search(searchTerm, limit, offset);

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error searching products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Filtre produits par catégorie
 * GET /api/products/category/:category
 */
exports.getByCategory = async (req, res) => {
  try {
    const category = req.params.category;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const products = await productModel.getByCategory(category, limit, offset);

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error getting products by category:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère toutes les catégories
 * GET /api/products/categories/list
 */
exports.getCategories = async (req, res) => {
  try {
    const categories = await productModel.getCategories();
    res.json({ success: true, data: categories });
  } catch (error) {
    console.error('Error getting categories:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les statistiques de stock
 * GET /api/products/stock-summary
 */
exports.getStockSummary = async (req, res) => {
  try {
    const summary = await productModel.getStockSummary();
    res.json({ success: true, data: summary });
  } catch (error) {
    console.error('Error getting stock summary:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère l'historique des ventes d'un produit
 * GET /api/products/:id/sales-history
 */
exports.getSalesHistory = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;

    const history = await productModel.getSalesHistory(productId, limit);

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting sales history:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les clients ayant acheté un produit
 * GET /api/products/:id/customers
 */
exports.getCustomers = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;

    const customers = await productModel.getCustomers(productId, limit);

    res.json({ success: true, data: customers });
  } catch (error) {
    console.error('Error getting product customers:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les produits liés (achetés ensemble)
 * GET /api/products/:id/related
 */
exports.getRelatedProducts = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 10;

    const products = await advancedFilterService.getRelatedProducts(productId, limit);

    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error getting related products:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Met à jour le coût personnalisé d'un produit
 * PUT /api/products/:id/cost
 * Body: { cost_price_custom: 5.20 }
 */
exports.updateCostPrice = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const { cost_price_custom } = req.body;

    if (cost_price_custom === undefined || cost_price_custom === null) {
      return res.status(400).json({
        success: false,
        error: 'cost_price_custom is required'
      });
    }

    const product = await productModel.updateCostPrice(productId, cost_price_custom);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }

    res.json({
      success: true,
      message: 'Cost price updated successfully',
      data: product
    });
  } catch (error) {
    console.error('Error updating cost price:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
