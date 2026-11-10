/**
 * Catalogue caisse (produits du site → Nextore) : liste à vérifier et actions.
 * Le catalogue Nextore est commun aux deux boutiques : accessible depuis l'une
 * ou l'autre. Le stock affiché est celui de Castelnau (warehouse 2).
 */

const catalogReviewModel = require('../models/catalogReviewModel');
const prelevementModel = require('../models/prelevementModel');
const sync = require('../services/nextoreCatalogSyncService');

const WH = 2;

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.statusCode) console.error('[Catalogue caisse]', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};
const ids = (body) => (Array.isArray(body?.ids) ? body.ids.map((x) => parseInt(x, 10)).filter(Number.isInteger) : []);

module.exports = {
  reviews: handle(async (req, res) => {
    res.json(await catalogReviewModel.list({
      reason: req.query.reason, q: req.query.q, offset: req.query.offset, limit: req.query.limit, same: req.query.same === '1', near: req.query.near === '1',
    }));
  }),
  ignore: handle(async (req, res) => {
    res.json(await catalogReviewModel.ignore(parseInt(req.params.id, 10), req.user.id));
  }),
  alignPrices: handle(async (req, res) => {
    res.json(await catalogReviewModel.alignPrices(ids(req.body), req.user.id));
  }),
  keepPrices: handle(async (req, res) => {
    res.json(await catalogReviewModel.keepPrices(ids(req.body), req.user.id));
  }),
  linkSame: handle(async (req, res) => {
    res.json(await catalogReviewModel.linkSame(ids(req.body), req.user.id));
  }),
  product: handle(async (req, res) => {
    res.json(await prelevementModel.productView(parseInt(req.params.productId, 10), WH, req.user.id));
  }),
  searchNextore: handle(async (req, res) => {
    res.json(await prelevementModel.searchNextore(WH, req.query.q));
  }),
  link: handle(async (req, res) => {
    if (!req.body?.nxProductId) return res.status(400).json({ error: 'Produit caisse manquant.' });
    res.json(await prelevementModel.link(WH, parseInt(req.params.productId, 10), req.body.nxProductId, req.user.id));
  }),
  unlink: handle(async (req, res) => {
    res.json(await prelevementModel.unlink(parseInt(req.params.productId, 10), req.user.id));
  }),
  createInNextore: handle(async (req, res) => {
    res.json(await prelevementModel.createInNextore(WH, parseInt(req.params.productId, 10), req.body?.categoryId, req.user.id));
  }),
  labels: handle(async (req, res) => {
    const { resolveWarehouse } = require('../config/nextore');
    res.json(await catalogReviewModel.labels(resolveWarehouse(req.params.shop).id, { todo: req.query.all !== '1' }));
  }),
  labelsDone: handle(async (req, res) => {
    const { resolveWarehouse } = require('../config/nextore');
    res.json(await catalogReviewModel.labelsDone(resolveWarehouse(req.params.shop).id, ids(req.body), req.user.id, req.body?.done !== false));
  }),
  revertLabel: handle(async (req, res) => {
    res.json(await catalogReviewModel.revertLabel(parseInt(req.params.id, 10), req.user.id));
  }),
  uncategorized: handle(async (req, res) => {
    const pool = require('../config/database');
    const [groups, { rows: categories }] = await Promise.all([
      catalogReviewModel.uncategorizedGroups(),
      // Toutes les catégories caisse, même sans stock en boutique (HUILE CBD…).
      pool.query(`SELECT id, name FROM nextore_categories WHERE name NOT IN ('Test', 'Zzzzzzzzzzzz') ORDER BY name`),
    ]);
    res.json({ groups, categories });
  }),
  setGroupCategory: handle(async (req, res) => {
    res.json(await catalogReviewModel.setGroupCategory(req.body || {}));
  }),
  createAll: handle(async (req, res) => {
    res.json(await catalogReviewModel.createAllAbsent(req.user.id));
  }),
  createAllStatus: handle(async (req, res) => {
    res.json(catalogReviewModel.bulkStatus());
  }),
  run: handle(async (req, res) => {
    res.json(await sync.run({ dryRun: req.body?.dryRun === true }));
  }),
};
