/**
 * Boutiques physiques (Nextore) — contrôleur.
 * Endpoints scopés par boutique (:shop = slug ou warehouse_id).
 */

const nextoreModel = require('../models/nextoreModel');
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

module.exports = { postSync, getStock, getStockHistory };
