/**
 * Boutiques physiques (Nextore) — contrôleur.
 * Endpoints scopés par boutique (:shop = slug ou warehouse_id).
 */

const nextoreModel = require('../models/nextoreModel');
const nextoreImportModel = require('../models/nextoreImportModel');
const boutiqueOrderModel = require('../models/boutiqueOrderModel');
const comptageModel = require('../models/nextoreComptageModel');
const { resolveWarehouse } = require('../config/nextore');

/** Résout la boutique depuis req.params.shop, renvoie 400 sinon. */
function getShopOr400(req, res) {
  const wh = resolveWarehouse(req.params.shop);
  if (!wh) {
    res.status(400).json({ error: `Boutique inconnue : "${req.params.shop}" (attendu montpellier|castelnau ou 1|2)` });
    return null;
  }
  return wh;
}

// POST /api/nextore/sync — synchro globale (catalogue + stock des 2 boutiques)
async function postSync(req, res) {
  try {
    const result = await nextoreModel.syncAll();
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Nextore syncAll:', err);
    res.status(500).json({ error: err.message || 'Erreur de synchronisation Nextore' });
  }
}

// GET /api/nextore/:shop/stock — relevé de stock d'une boutique
async function getStock(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const opts = {
      search: req.query.search ? String(req.query.search).trim() : null,
      onlyInStock: req.query.only_in_stock === '1' || req.query.only_in_stock === 'true',
      showDisabled: req.query.show_disabled === '1',
      categoryId: req.query.category || null,
      subcategoryId: req.query.subcategory || null,
      brand: req.query.brand || null,
      dormantDays: Math.min(Math.max(parseInt(req.query.dormant_days, 10) || 0, 0), 3650) || null,
    };
    const [rows, summary, lastSyncAt] = await Promise.all([
      nextoreModel.getStockDashboard(wh.id, opts),
      nextoreModel.getStockSummary(wh.id),
      nextoreModel.getLastSyncAt(),
    ]);
    res.json({ warehouse: wh, summary, lastSyncAt, rows });
  } catch (err) {
    console.error('Nextore getStock:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération stock' });
  }
}

// GET /api/nextore/:shop/needs — prévision d'achat (besoins), logique V2
async function getNeeds(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const result = await nextoreModel.getNeeds(wh.id, {
      analysisDays: req.query.period,
      alertDays: req.query.seuil,
      coverageDays: req.query.coverage,
      supplierId: req.query.supplier || null,
    });
    const lastSyncAt = await nextoreModel.getLastSyncAt();
    res.json({ warehouse: wh, lastSyncAt, ...result });
  } catch (err) {
    console.error('Nextore getNeeds:', err);
    res.status(500).json({ error: err.message || 'Erreur calcul des besoins' });
  }
}

// GET /api/nextore/:shop/suppliers — fournisseurs de la boutique (pour le filtre)
async function getSuppliers(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const suppliers = await nextoreModel.getSuppliersForShop(wh.id);
    res.json({ warehouse: wh, suppliers });
  } catch (err) {
    console.error('Nextore getSuppliers:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération fournisseurs' });
  }
}

// GET /api/nextore/:shop/needs-data — données brutes pour l'écran Besoins V2 (calcul client)
async function getNeedsData(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const [{ products, suppliers }, categories, lastSyncAt] = await Promise.all([
      nextoreModel.getNeedsData(wh.id),
      nextoreModel.getCategoriesForShop(wh.id),
      nextoreModel.getLastSyncAt(),
    ]);
    res.json({ warehouse: wh, lastSyncAt, products, suppliers, categories });
  } catch (err) {
    console.error('Nextore getNeedsData:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération données besoins' });
  }
}

// POST /api/nextore/:shop/purchases — crée une commande (réceptionnée ensuite dans l'app)
// Body : { supplier_id, items: [{ product_id, quantity }] } (pas de prix : calculé serveur)
async function postPurchase(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  const { supplier_id: supplierId, items } = req.body || {};
  const lines = Array.isArray(items)
    ? items.filter((l) => l && l.product_id && Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0)
    : [];
  if (!supplierId || !lines.length || lines.length !== items.length) {
    return res.status(400).json({ error: 'Fournisseur et lignes (quantités entières > 0) requis' });
  }
  try {
    const result = await nextoreModel.createPurchase(wh, supplierId, lines, req.user?.email);
    console.log(`Boutique commande ${result.reference} créée par ${req.user?.email} (${result.lines} lignes)`);
    res.json(result);
  } catch (err) {
    console.error('Nextore postPurchase:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur création commande' });
  }
}

// --- Import de commande fournisseur (parseurs du site) ----------------------
const sendImportError = (res, label, err) => {
  if (!err.status || err.status >= 500) console.error(`Nextore import ${label}:`, err);
  res.status(err.status || 500).json({ error: err.message || 'Erreur import commande', code: err.code });
};

// GET /api/nextore/:shop/import/suppliers — fournisseurs qui ont un parseur
async function getImportSuppliers(req, res) {
  try {
    res.json({ suppliers: await nextoreImportModel.listSuppliers() });
  } catch (err) { sendImportError(res, 'suppliers', err); }
}

// POST /api/nextore/:shop/import/parse — multipart : pdf + supplier_id
async function postImportParse(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });
  try {
    res.json(await nextoreImportModel.parseDocument(req.file.buffer, req.body.supplier_id, wh));
  } catch (err) { sendImportError(res, 'parse', err); }
}

// POST /api/nextore/:shop/import/map-line — conditionnement proposé + ligne convertie
async function postImportMapLine(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  const b = req.body || {};
  try {
    res.json(await nextoreImportModel.mapLine({
      nxSupplierId: b.supplier_id, warehouse: wh, productId: b.product_id, supplierSku: b.supplier_sku,
      packQty: b.pack_qty, docQty: b.qty_from_pdf, docPrice: b.pdf_price_raw, discountPercent: b.discount_percent,
      conversion: b.conversion,
    }));
  } catch (err) { sendImportError(res, 'map-line', err); }
}

// POST /api/nextore/:shop/import/purchase — crée la commande (réceptionnée ensuite dans l'app)
async function postImportPurchase(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  const b = req.body || {};
  try {
    const result = await nextoreImportModel.createPurchase({
      nxSupplierId: b.supplier_id, warehouse: wh, referenceNo: b.reference_no, lines: b.lines,
      newSupplierSkus: b.new_supplier_skus, existingOrderId: b.existing_order_id, userEmail: req.user?.email,
    });
    console.log(`Boutique commande importée ${result.reference} (#${result.orderId}) par ${req.user?.email} `
      + `(${result.added ? `${result.added.length} lignes ajoutées` : `${result.lines} lignes`})`);
    res.json(result);
  } catch (err) { sendImportError(res, 'purchase', err); }
}

// --- Réception des commandes boutique (boutiqueOrderModel) ------------------
// Chaque appel est borné à la boutique de l'URL : une commande d'une autre
// boutique répond 404, même avec un id valide.
const receptionHandler = (label, fn) => async (req, res) => {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    res.json(await fn(wh, req));
  } catch (err) {
    if (!err.status || err.status >= 500) console.error(`Boutique réception ${label}:`, err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur réception' });
  }
};

const getReceptionOrders = receptionHandler('orders', async (wh) => ({ orders: await boutiqueOrderModel.listOrders(wh.id) }));
const getReceptionOrder = receptionHandler('order', (wh, req) => boutiqueOrderModel.getOrder(req.params.id, wh.id));
const deleteReceptionOrder = receptionHandler('delete', async (wh, req) => {
  await boutiqueOrderModel.deleteOrder(req.params.id, wh.id);
  console.log(`Boutique commande ${req.params.id} (${wh.code}) supprimée par ${req.user?.email}`);
  return { ok: true };
});
const postReceptionOrder = receptionHandler('create', async (wh, req) => {
  const b = req.body || {};
  const result = await boutiqueOrderModel.createManualOrder({
    warehouse: wh, supplierId: b.supplier_id, reference: b.reference, lines: b.lines, userEmail: req.user?.email,
  });
  console.log(`Boutique commande manuelle ${result.reference} (#${result.orderId}) créée par ${req.user?.email} (${result.lines} lignes)`);
  return result;
});
const getReceptionCosts = receptionHandler('costs', async (wh, req) => {
  const ids = String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!req.query.supplier_id || !ids.length) return { costs: {} };
  return { costs: Object.fromEntries(await boutiqueOrderModel.defaultCosts(req.query.supplier_id, ids)) };
});
const putReceptionOrder = receptionHandler('update', (wh, req) =>
  boutiqueOrderModel.updateOrder(req.params.id, wh.id, { reference: req.body?.reference, lines: req.body?.lines }));
const postReceptionSession = receptionHandler('session', (wh, req) =>
  boutiqueOrderModel.openSession(req.params.id, wh.id, req.user?.email));
const putReceptionCount = receptionHandler('count', (wh, req) =>
  boutiqueOrderModel.setCount(req.params.sessionId, wh.id, req.params.itemId, req.body?.units_counted));
const postReceptionLine = receptionHandler('line', (wh, req) =>
  boutiqueOrderModel.addLine(req.params.sessionId, wh.id, req.body?.product_id));
const postReceptionAbandon = receptionHandler('abandon', async (wh, req) => {
  await boutiqueOrderModel.abandonSession(req.params.sessionId, wh.id);
  return { ok: true };
});
const postReceptionBarcode = receptionHandler('barcode', (wh, req) => boutiqueOrderModel.saveBarcode({
  barcode: req.body?.barcode, productId: req.body?.product_id, kind: req.body?.kind,
  packQty: req.body?.pack_qty, orderItemId: req.body?.order_item_id, userEmail: req.user?.email, userId: req.user?.id,
}));
const postReceptionValidate = receptionHandler('validate', async (wh, req) => {
  const result = await boutiqueOrderModel.validateSession(req.params.sessionId, wh, req.body?.motifs, req.user?.email);
  console.log(`Boutique réception ${wh.code} session ${req.params.sessionId} validée par ${req.user?.email} : `
    + `${result.pieces} pièces, achat Nextore ${result.nextore_purchase_id || '(aucun envoi)'} ${result.nextore_reference || ''}`);
  return result;
});

// GET /api/nextore/:shop/stock/:productId/history — évolution du stock d'un produit
async function getStockHistory(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    const rows = await nextoreModel.getProductStockHistory(wh.id, req.params.productId, limit);
    res.json({ warehouse: wh, product_id: req.params.productId, history: rows });
  } catch (err) {
    console.error('Nextore getStockHistory:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération historique' });
  }
}

// GET /:shop/categories — catégories + sous-catégories (pour le comptage type 3)
async function getCategories(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const [categories, subcategories, brands] = await Promise.all([
      nextoreModel.getCategoriesForShop(wh.id),
      nextoreModel.getSubcategoriesForShop(wh.id),
      nextoreModel.getBrandsForShop(wh.id),
    ]);
    res.json({ warehouse: wh, categories, subcategories, brands });
  } catch (err) {
    console.error('Nextore getCategories:', err);
    res.status(500).json({ error: err.message || 'Erreur' });
  }
}

// GET /:shop/products/search — recherche produit (pour la liste de comptage manuelle)
async function searchProducts(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const products = await nextoreModel.getProductSearch(wh.id, {
      q: req.query.q ? String(req.query.q).trim() : null,
      categoryId: req.query.category || null,
      subcategoryId: req.query.subcategory || null,
      brand: req.query.brand || null,
      limit: req.query.limit,
      includeDisabled: req.query.all === '1',
    });
    res.json({ warehouse: wh, products });
  } catch (err) {
    console.error('Nextore searchProducts:', err);
    res.status(500).json({ error: err.message || 'Erreur recherche' });
  }
}

// GET /:shop/products/:productId — fiche produit (onglet Produits)
async function getProduct(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const product = await nextoreModel.getProductDetail(wh.id, req.params.productId);
    if (!product) return res.status(404).json({ error: 'Produit inconnu' });
    res.json({ warehouse: wh, product });
  } catch (err) {
    console.error('Nextore getProduct:', err);
    res.status(500).json({ error: err.message || 'Erreur' });
  }
}

// POST /:shop/products/disabled — { product_ids, disabled } : (dé)sactive dans cette boutique
async function postProductsDisabled(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  const ids = req.body?.product_ids;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'Aucun produit sélectionné' });
  try {
    const disabled = req.body?.disabled !== false;
    const updated = await nextoreModel.setProductsDisabled(wh.id, ids, disabled, req.user?.email);
    console.log(`Nextore ${wh.code} : ${updated} produit(s) ${disabled ? 'désactivé(s)' : 'réactivé(s)'} par ${req.user?.email}`);
    res.json({ ok: true, updated });
  } catch (err) {
    console.error('Nextore postProductsDisabled:', err);
    res.status(500).json({ error: err.message || 'Erreur' });
  }
}

// ===== COMPTAGE (inventaire) =====

// GET /:shop/comptages — liste des sessions
async function listComptages(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    res.json({ warehouse: wh, comptages: await comptageModel.listComptages(wh.id) });
  } catch (err) {
    console.error('Nextore listComptages:', err);
    res.status(500).json({ error: err.message || 'Erreur' });
  }
}

// POST /:shop/comptage — crée une session (type tournant|spontane|categorie)
async function createComptage(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const { type, name, filterType, filterId, productIds } = req.body || {};
    if (!['tournant', 'spontane', 'categorie', 'liste'].includes(type)) {
      return res.status(400).json({ error: 'type invalide (tournant|spontane|categorie|liste)' });
    }
    const comptage = await comptageModel.createComptage(wh.id, {
      type, name, filterType, filterId, createdBy: req.user?.email || null,
      productIds: Array.isArray(productIds) ? productIds.map(String) : [],
    });
    res.json({ warehouse: wh, comptage });
  } catch (err) {
    console.error('Nextore createComptage:', err);
    res.status(500).json({ error: err.message || 'Erreur création comptage' });
  }
}

/** Charge la session et vérifie qu'elle appartient bien à la boutique. */
async function loadOwned(req, res, wh) {
  const comptage = await comptageModel.getComptage(req.params.id);
  if (!comptage || Number(comptage.warehouse_id) !== Number(wh.id)) {
    res.status(404).json({ error: 'Comptage introuvable pour cette boutique' });
    return null;
  }
  return comptage;
}

/** Une session clôturée (validée ou abandonnée) n'accepte plus ni scan ni validation. */
function refuseIfClosed(comptage, res) {
  if (comptage.status === 'en_cours') return false;
  res.status(409).json({ error: 'Ce comptage est clôturé' });
  return true;
}

// GET /:shop/comptage/:id
async function getComptage(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const comptage = await loadOwned(req, res, wh);
    if (!comptage) return;
    res.json({ warehouse: wh, comptage });
  } catch (err) {
    console.error('Nextore getComptage:', err);
    res.status(500).json({ error: err.message || 'Erreur' });
  }
}

// POST /:shop/comptage/:id/count — {barcode} (scan +1) OU {product_id, qty, mode}
async function countComptage(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const comptage = await loadOwned(req, res, wh);
    if (!comptage || refuseIfClosed(comptage, res)) return;
    const { barcode, product_id, qty, mode } = req.body || {};
    let productId = product_id;
    if (barcode && !productId) {
      const candidates = await comptageModel.resolveBarcode(comptage.id, wh.id, barcode);
      if (!candidates.length) return res.status(404).json({ error: `Code-barres inconnu en boutique : ${barcode}`, barcode });
      if (candidates.length > 1) {
        return res.status(409).json({
          error: `Ce code-barres correspond à ${candidates.length} articles : choisis lequel`,
          code: 'AMBIGUOUS_BARCODE',
          barcode,
          candidates: candidates.map(({ product_id, name, sku, stock }) => ({ product_id, name, sku, stock })),
        });
      }
      productId = candidates[0].product_id;
    }
    if (!productId) return res.status(400).json({ error: 'barcode ou product_id requis' });
    const result = await comptageModel.recordCount(comptage.id, wh.id, String(productId), {
      qty: qty != null ? Number(qty) : 1,
      mode: mode === 'set' ? 'set' : 'scan',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Nextore countComptage:', err);
    res.status(500).json({ error: err.message || 'Erreur comptage' });
  }
}

// POST /:shop/comptage/:id/validate — {mode: partial|final, zeroProductIds?}
async function validateComptage(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const comptage = await loadOwned(req, res, wh);
    if (!comptage || refuseIfClosed(comptage, res)) return;
    const { mode, zeroProductIds } = req.body || {};
    const out = await comptageModel.validateComptage(comptage.id, wh.id, {
      mode: mode === 'final' ? 'final' : 'partial',
      zeroProductIds: Array.isArray(zeroProductIds) ? zeroProductIds.map(String) : [],
      validatedBy: req.user?.email || null,
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('Nextore validateComptage:', err);
    res.status(500).json({ error: err.message || 'Erreur validation' });
  }
}

// POST /:shop/comptage/:id/abandon — ferme sans rien pousser de plus
async function abandonComptage(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const comptage = await loadOwned(req, res, wh);
    if (!comptage || refuseIfClosed(comptage, res)) return;
    const out = await comptageModel.abandonComptage(comptage.id, { abandonedBy: req.user?.email || null });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('Nextore abandonComptage:', err);
    res.status(err.status || 500).json({ error: err.message || 'Erreur abandon' });
  }
}

module.exports = {
  postSync,
  getStock,
  getNeeds,
  getNeedsData,
  postPurchase,
  getImportSuppliers,
  postImportParse,
  postImportMapLine,
  postImportPurchase,
  getReceptionOrders,
  getReceptionOrder,
  deleteReceptionOrder,
  putReceptionOrder,
  postReceptionOrder,
  getReceptionCosts,
  postReceptionSession,
  putReceptionCount,
  postReceptionLine,
  postReceptionAbandon,
  postReceptionBarcode,
  postReceptionValidate,
  getSuppliers,
  getStockHistory,
  getProduct,
  postProductsDisabled,
  // Comptage (inventaire)
  getCategories,
  searchProducts,
  listComptages,
  createComptage,
  getComptage,
  countComptage,
  validateComptage,
  abandonComptage,
};
