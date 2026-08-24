/**
 * Boutiques physiques (Nextore) — contrôleur.
 * Endpoints scopés par boutique (:shop = slug ou warehouse_id).
 */

const nextoreModel = require('../models/nextoreModel');
const linksModel = require('../models/nextoreLinksModel');
const matchService = require('../services/nextoreMatchService');
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
    const [products, suppliers, categories, lastSyncAt] = await Promise.all([
      nextoreModel.getNeedsData(wh.id),
      nextoreModel.getSuppliersForShop(wh.id),
      nextoreModel.getCategoriesForShop(wh.id),
      nextoreModel.getLastSyncAt(),
    ]);
    res.json({ warehouse: wh, lastSyncAt, products, suppliers, categories });
  } catch (err) {
    console.error('Nextore getNeedsData:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération données besoins' });
  }
}

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

// --- Rapprochement caisse <-> site ----------------------------------------

// POST /api/nextore/:shop/match/run — relance le moteur (propose, ne valide pas)
async function postRunMatching(req, res) {
  if (!getShopOr400(req, res)) return;
  try {
    const result = await matchService.runMatching({
      onlyInStock: req.body?.all !== true && req.body?.all !== 'true',
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Nextore runMatching:', err);
    res.status(500).json({ error: err.message || 'Erreur du moteur de rapprochement' });
  }
}

// GET /api/nextore/:shop/match — file de validation + compteurs
async function getMatches(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    // ?scope=all → tout le catalogue, sinon seulement le stock de CETTE boutique
    const shopId = req.query.scope === 'all' ? null : wh.id;
    const [rows, summary] = await Promise.all([
      linksModel.listLinks({
        shopId,
        status: req.query.status || 'pending',
        method: req.query.method,
        search: req.query.search,
        onlyWarnings: req.query.warnings === '1',
        minEcartPct: req.query.min_ecart_pct,
        minImpact: req.query.min_impact,
        sort: req.query.sort,
        dir: req.query.dir,
        limit: req.query.limit,
        offset: req.query.offset,
      }),
      linksModel.getSummary(shopId),
    ]);
    res.json({ warehouse: wh, summary, rows });
  } catch (err) {
    console.error('Nextore getMatches:', err);
    res.status(500).json({ error: err.message || 'Erreur récupération des rapprochements' });
  }
}

// GET /api/nextore/:shop/match/search?q= — produits site, pour rattacher à la main
async function getWcSearch(req, res) {
  if (!getShopOr400(req, res)) return;
  try {
    res.json({ rows: await linksModel.searchWcProducts(req.query.q, req.query.limit) });
  } catch (err) {
    console.error('Nextore getWcSearch:', err);
    res.status(500).json({ error: err.message || 'Erreur de recherche produit' });
  }
}

// PATCH /api/nextore/:shop/match/:nxId — arbitrage d'un lien
async function patchMatch(req, res) {
  if (!getShopOr400(req, res)) return;
  try {
    const link = await linksModel.updateLink(req.params.nxId, {
      ...(req.body.wc_product_id !== undefined ? { wcProductId: req.body.wc_product_id } : {}),
      ...(req.body.pack_qty !== undefined ? { packQty: req.body.pack_qty } : {}),
      ...(req.body.status !== undefined ? { status: req.body.status } : {}),
    }, req.user?.id);
    res.json({ ok: true, link });
  } catch (err) {
    console.error('Nextore patchMatch:', err);
    res.status(400).json({ error: err.message || 'Erreur de mise à jour du lien' });
  }
}

// POST /api/nextore/:shop/match/bulk — validation / rejet en masse
async function postMatchBulk(req, res) {
  if (!getShopOr400(req, res)) return;
  try {
    const result = await linksModel.bulkUpdateStatus(req.body.ids, req.body.status, req.user?.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Nextore postMatchBulk:', err);
    res.status(400).json({ error: err.message || 'Erreur de mise à jour en masse' });
  }
}

// GET /:shop/categories — catégories + sous-catégories (pour le comptage type 3)
async function getCategories(req, res) {
  const wh = getShopOr400(req, res);
  if (!wh) return;
  try {
    const [categories, subcategories] = await Promise.all([
      nextoreModel.getCategoriesForShop(wh.id),
      nextoreModel.getSubcategoriesForShop(wh.id),
    ]);
    res.json({ warehouse: wh, categories, subcategories });
  } catch (err) {
    console.error('Nextore getCategories:', err);
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
    const { type, name, filterType, filterId } = req.body || {};
    if (!['tournant', 'spontane', 'categorie'].includes(type)) {
      return res.status(400).json({ error: 'type invalide (tournant|spontane|categorie)' });
    }
    const comptage = await comptageModel.createComptage(wh.id, {
      type, name, filterType, filterId, createdBy: req.user?.email || null,
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
    if (!comptage) return;
    const { barcode, product_id, qty, mode } = req.body || {};
    let productId = product_id;
    if (barcode && !productId) {
      const prod = await comptageModel.resolveBarcode(wh.id, barcode);
      if (!prod) return res.status(404).json({ error: `Code-barres inconnu en boutique : ${barcode}`, barcode });
      productId = prod.product_id;
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
    if (!comptage) return;
    const { mode, zeroProductIds } = req.body || {};
    const out = await comptageModel.validateComptage(comptage.id, wh.id, {
      mode: mode === 'final' ? 'final' : 'partial',
      zeroProductIds: Array.isArray(zeroProductIds) ? zeroProductIds.map(String) : [],
    });
    res.json({ ok: true, ...out });
  } catch (err) {
    console.error('Nextore validateComptage:', err);
    res.status(500).json({ error: err.message || 'Erreur validation' });
  }
}

module.exports = {
  postSync,
  getStock,
  getNeeds,
  getNeedsData,
  getSuppliers,
  getStockHistory,
  // Rapprochement caisse <-> site
  postRunMatching,
  getMatches,
  getWcSearch,
  patchMatch,
  postMatchBulk,
  // Comptage (inventaire)
  getCategories,
  listComptages,
  createComptage,
  getComptage,
  countComptage,
  validateComptage,
};
