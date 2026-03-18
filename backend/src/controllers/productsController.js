const productModel = require('../models/productModel');
const advancedFilterService = require('../services/advancedFilterService');
const bmsApiModel = require('../models/bmsApiModel');
const needsCalculationModel = require('../models/needsCalculationModel');
const pool = require('../config/database');

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

/**
 * Toggle exclude_from_reorder
 * PATCH /api/products/:id/exclude-reorder
 */
exports.toggleExcludeReorder = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    // Toggle le produit lui-meme
    const result = await pool.query(
      `UPDATE products SET exclude_from_reorder = NOT COALESCE(exclude_from_reorder, false) WHERE wp_product_id = $1 RETURNING wp_product_id, exclude_from_reorder, product_type`,
      [productId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found' });
    }
    const product = result.rows[0];
    // Si c'est un variable (parent), toggle aussi toutes ses variations
    if (product.product_type === 'variable') {
      await pool.query(
        `UPDATE products SET exclude_from_reorder = $1 WHERE wp_parent_id = $2`,
        [product.exclude_from_reorder, productId]
      );
    }
    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error toggling exclude_from_reorder:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les produits pour l'onglet Stats avec pagination et tri
 * GET /api/products/stats-list?limit=50&offset=0&search=&sortBy=qty_sold&sortOrder=DESC
 */
exports.getStatsListing = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const searchTerm = req.query.search || '';
    const sortBy = req.query.sortBy || 'qty_sold';
    const sortOrder = req.query.sortOrder || 'DESC';
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;

    const products = await productModel.getAllForStats(limit, offset, searchTerm, sortBy, sortOrder, dateFrom, dateTo);
    const total = await productModel.countForStats(searchTerm);

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
    console.error('Error getting products stats listing:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les produits pour le catalogue (paramétrage)
 * GET /api/products/catalog
 */
exports.getCatalogList = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';

    const products = await productModel.getAllForCatalog(limit, offset, search);
    const total = await productModel.countForCatalog(search);

    res.json({
      success: true,
      data: products,
      pagination: { total, limit, offset, hasMore: offset + limit < total }
    });
  } catch (error) {
    console.error('Error getting catalog list:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recupere les variations d'un produit parent pour le catalogue
 * GET /api/products/:id/catalog-variations
 */
exports.getCatalogVariations = async (req, res) => {
  try {
    const wpProductId = parseInt(req.params.id);
    const result = await pool.query(`
      SELECT p.id, p.wp_product_id, p.post_title, p.sku,
        COALESCE(p.stock, 0) as stock, p.regular_price,
        COALESCE(p.image_url, (SELECT image_url FROM products WHERE wp_product_id = $1)) as image_url
      FROM products p
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY p.post_title ASC
    `, [wpProductId]);
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error getting catalog variations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les données d'un produit pour la fiche catalogue
 * GET /api/products/:id/catalog
 */
exports.getCatalogDetail = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const product = await productModel.getForCatalogDetail(productId);

    if (!product) {
      return res.status(404).json({ success: false, error: 'Produit non trouvé' });
    }

    res.json({ success: true, data: product });
  } catch (error) {
    console.error('Error getting catalog detail:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les variations d'un produit pour l'onglet Stats
 * GET /api/products/:id/variations-stats
 */
exports.getVariationsStats = async (req, res) => {
  try {
    const productId = req.params.id;
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const variations = await productModel.getVariationsForStats(productId, dateFrom, dateTo);

    res.json({ success: true, data: variations });
  } catch (error) {
    console.error('Error getting product variations stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Récupère les codes-barres d'un produit
 * GET /api/products/:id/barcodes
 */
exports.getProductBarcodes = async (req, res) => {
  try {
    const wpProductId = parseInt(req.params.id);
    const product = await pool.query('SELECT id FROM products WHERE wp_product_id = $1', [wpProductId]);
    if (!product.rows[0]) return res.status(404).json({ success: false, error: 'Produit introuvable' });
    const barcodes = await productModel.getBarcodes(product.rows[0].id);
    res.json({ success: true, data: barcodes });
  } catch (error) {
    console.error('Error getting barcodes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recupere les variations d'un produit parent avec leurs codes-barres
 * GET /api/products/:id/variations-barcodes
 */
exports.getVariationsBarcodes = async (req, res) => {
  try {
    const wpProductId = parseInt(req.params.id);
    const variations = await pool.query(`
      SELECT p.id, p.wp_product_id, p.post_title, p.sku, COALESCE(p.stock, 0) as stock
      FROM products p
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY p.post_title ASC
    `, [wpProductId]);

    const result = [];
    for (const v of variations.rows) {
      const barcodes = await productModel.getBarcodes(v.id);
      result.push({ ...v, barcodes });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error getting variations barcodes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Recupere les besoins par variation pour un produit parent
 * GET /api/products/:id/variations-needs
 */
exports.getVariationsNeeds = async (req, res) => {
  try {
    const wpProductId = parseInt(req.params.id);
    const variations = await pool.query(`
      SELECT p.id, p.wp_product_id, p.post_title, p.sku, COALESCE(p.stock, 0)::int as stock
      FROM products p
      WHERE p.wp_parent_id = $1 AND p.product_type = 'variation'
      ORDER BY p.post_title ASC
    `, [wpProductId]);

    // Arrivages en cours par variation (internal id)
    const varIds = variations.rows.map(v => v.id);
    let incomingMap = new Map();
    if (varIds.length > 0) {
      const incomingResult = await pool.query(`
        SELECT poi.product_id, COALESCE(SUM(poi.qty_ordered - poi.qty_received), 0)::int as incoming_qty
        FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.purchase_order_id = po.id
        WHERE po.status IN ('sent', 'confirmed', 'shipped', 'partial')
          AND poi.product_id = ANY($1)
        GROUP BY poi.product_id
      `, [varIds]);
      for (const row of incomingResult.rows) {
        incomingMap.set(parseInt(row.product_id), parseInt(row.incoming_qty) || 0);
      }
    }

    // Calculer les besoins par variation
    const result = [];
    for (const v of variations.rows) {
      const needs = await needsCalculationModel.calculateProductNeeds(v.wp_product_id, 1, 1);
      result.push({
        ...v,
        incoming_qty: incomingMap.get(v.id) || 0,
        ...needs
      });
    }

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Error getting variations needs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Ajoute un code-barre à un produit
 * POST /api/products/:id/barcodes
 */
exports.addProductBarcode = async (req, res) => {
  try {
    const wpProductId = parseInt(req.params.id);
    const { barcode, type, quantity } = req.body;

    if (!barcode || !type || !['unit', 'pack'].includes(type)) {
      return res.status(400).json({ success: false, error: 'barcode et type (unit/pack) requis' });
    }

    const product = await pool.query('SELECT id FROM products WHERE wp_product_id = $1', [wpProductId]);
    if (!product.rows[0]) return res.status(404).json({ success: false, error: 'Produit introuvable' });

    const qty = type === 'pack' && quantity ? parseInt(quantity) : null;
    const result = await productModel.addBarcode(product.rows[0].id, barcode.trim(), type, qty);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ success: false, error: 'Ce code-barre existe déjà pour ce produit' });
    }
    console.error('Error adding barcode:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Supprime un code-barre
 * DELETE /api/products/:id/barcodes/:barcodeId
 */
exports.deleteProductBarcode = async (req, res) => {
  try {
    const barcodeId = parseInt(req.params.barcodeId);
    const result = await productModel.deleteBarcode(barcodeId);

    if (!result) {
      return res.status(404).json({ success: false, error: 'Code-barre non trouvé' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting barcode:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Import CSV de codes-barres unitaires
 * POST /api/products/barcodes/import
 */
/**
 * Récupère le code-barre BMS pour un produit donné
 * POST /api/products/:id/barcodes/fetch-bms
 */
exports.fetchBmsBarcode = async (req, res) => {
  try {
    const productId = parseInt(req.params.id);
    const product = await pool.query('SELECT id, sku FROM products WHERE wp_product_id = $1', [productId]);
    if (!product.rows[0]?.sku) {
      return res.status(404).json({ success: false, error: 'Produit ou SKU introuvable' });
    }

    const { id: internalId, sku } = product.rows[0];

    // Chercher dans le cache BMS ou fetcher
    const bmsProducts = await bmsApiModel.getCatalogProducts();
    const bmsProduct = bmsProducts.find(p => p.sku === sku);

    if (!bmsProduct || !bmsProduct.barcode) {
      return res.json({ success: true, data: null, message: 'Aucun code-barre trouve dans BMS pour ce SKU' });
    }

    // Inserer si pas deja present
    const result = await pool.query(
      'INSERT INTO product_barcodes (product_id, barcode, type) VALUES ($1, $2, $3) ON CONFLICT (product_id, barcode) DO NOTHING RETURNING *',
      [internalId, bmsProduct.barcode, 'unit']
    );

    if (result.rows[0]) {
      res.json({ success: true, data: result.rows[0], message: 'Code-barre importe depuis BMS' });
    } else {
      res.json({ success: true, data: null, message: 'Ce code-barre existe deja' });
    }
  } catch (error) {
    console.error('Error fetching BMS barcode:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Sync tous les codes-barres depuis BMS pour les produits qui n'en ont pas
 * Appelé par le cron
 */
exports.syncBarcodesFromBMS = async () => {
  console.log('[BMS Barcode Sync] Debut...');
  try {
    // Produits sans code-barre unite
    const productsWithout = await pool.query(`
      SELECT p.id, p.sku
      FROM products p
      WHERE p.sku IS NOT NULL AND p.sku != ''
        AND NOT EXISTS (
          SELECT 1 FROM product_barcodes pb WHERE pb.product_id = p.id AND pb.type = 'unit'
        )
    `);

    if (productsWithout.rows.length === 0) {
      console.log('[BMS Barcode Sync] Tous les produits ont deja un code-barre');
      return { synced: 0, total: 0 };
    }

    console.log(`[BMS Barcode Sync] ${productsWithout.rows.length} produits sans code-barre`);

    // Fetch tous les produits BMS
    const bmsProducts = await bmsApiModel.getCatalogProducts();
    const bmsMap = new Map();
    for (const bp of bmsProducts) {
      if (bp.sku && bp.barcode) {
        bmsMap.set(bp.sku, bp.barcode);
      }
    }

    console.log(`[BMS Barcode Sync] ${bmsMap.size} produits BMS avec code-barre`);

    let synced = 0;
    for (const product of productsWithout.rows) {
      const barcode = bmsMap.get(product.sku);
      if (barcode) {
        await pool.query(
          'INSERT INTO product_barcodes (product_id, barcode, type) VALUES ($1, $2, $3) ON CONFLICT (product_id, barcode) DO NOTHING',
          [product.id, barcode, 'unit']
        );
        synced++;
      }
    }

    console.log(`[BMS Barcode Sync] ${synced} codes-barres importes`);
    return { synced, total: productsWithout.rows.length };
  } catch (error) {
    console.error('[BMS Barcode Sync] Erreur:', error.message);
    throw error;
  }
};

exports.importBarcodes = async (req, res) => {
  try {
    const { rows } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows requis (tableau de {sku, barcode})' });
    }

    const results = await productModel.importBarcodes(rows);
    res.json({ success: true, data: results });
  } catch (error) {
    console.error('Error importing barcodes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
