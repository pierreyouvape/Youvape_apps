/**
 * Prélèvements du stock du site par la boutique de Castelnau (EMC → EMC2).
 * Monté dans nextoreRoutes : JWT + droit de la boutique.
 */

const prelevementModel = require('../models/prelevementModel');
const { resolveWarehouse } = require('../config/nextore');

// Seule Castelnau (EMC2) prélève au site : Montpellier est dans la même société (EMC).
const PRELEVEMENT_WAREHOUSES = [2];

const handle = (fn) => async (req, res) => {
  const wh = resolveWarehouse(req.params.shop);
  if (!wh || !PRELEVEMENT_WAREHOUSES.includes(wh.id)) {
    return res.status(400).json({ error: 'Les prélèvements ne concernent que la boutique de Castelnau.' });
  }
  try {
    await fn(req, res, wh);
  } catch (error) {
    if (!error.statusCode) console.error('[Prélèvements]', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const frNum = (v) => (v == null ? '' : String(v).replace('.', ','));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = {
  lookup: handle(async (req, res, wh) => {
    res.json(await prelevementModel.lookup(wh.id, req.query.q, req.user.id));
  }),

  product: handle(async (req, res, wh) => {
    res.json(await prelevementModel.productView(parseInt(req.params.productId, 10), wh.id, req.user.id));
  }),

  searchNextore: handle(async (req, res, wh) => {
    res.json(await prelevementModel.searchNextore(wh.id, req.query.q));
  }),

  create: handle(async (req, res, wh) => {
    const { productId, qty, note } = req.body || {};
    const row = await prelevementModel.record({
      warehouseId: wh.id, productId: parseInt(productId, 10), qty, userId: req.user.id, origin: 'boutique', note,
    });
    res.json(row);
  }),

  link: handle(async (req, res, wh) => {
    const { nxProductId } = req.body || {};
    if (!nxProductId) return res.status(400).json({ error: 'Produit caisse manquant.' });
    res.json(await prelevementModel.link(wh.id, parseInt(req.params.productId, 10), nxProductId, req.user.id));
  }),

  createInNextore: handle(async (req, res, wh) => {
    const { categoryId } = req.body || {};
    res.json(await prelevementModel.createInNextore(wh.id, parseInt(req.params.productId, 10), categoryId, req.user.id));
  }),

  list: handle(async (req, res, wh) => {
    const from = ISO_DATE.test(req.query.from || '') ? req.query.from : null;
    const to = ISO_DATE.test(req.query.to || '') ? req.query.to : null;
    res.json(await prelevementModel.list(wh.id, { from, to, problems: req.query.problems === '1' }));
  }),

  cancel: handle(async (req, res, wh) => {
    res.json(await prelevementModel.cancel(wh.id, parseInt(req.params.id, 10), req.user.id));
  }),

  resolveStep: handle(async (req, res, wh) => {
    const { step, action } = req.body || {};
    res.json(await prelevementModel.resolveStep(wh.id, parseInt(req.params.id, 10), step, action));
  }),

  exportCsv: handle(async (req, res, wh) => {
    const { from, to } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) return res.status(400).json({ error: 'Période invalide.' });
    const rows = await prelevementModel.exportRows(wh.id, from, to);
    const head = ['Date', 'Mois', 'Catégorie', 'Marque', 'Sous-marque', 'SKU', 'Produit', 'Quantité',
      'Coût unitaire HT', 'Total HT', 'Prix site TTC', 'Origine', 'Par', 'Sortie du stock site'];
    const lines = rows.map((r) => [
      r.date, r.month, r.category, r.brand, r.sub_brand, r.sku, r.name, r.qty,
      frNum(r.unit_cost_ht), frNum(r.total_ht), frNum(r.site_price_ttc),
      r.origin === 'pda' ? 'Vente boutique (ancien, reprise)' : 'Prélèvement',
      r.user_name, r.site_status === 'sent' ? 'faite' : r.site_status,
    ].map(csvCell).join(';'));
    const total = rows.reduce((s, r) => s + Number(r.total_ht || 0), 0);
    lines.push(['', '', '', '', '', '', 'TOTAL', rows.reduce((s, r) => s + r.qty, 0), '', frNum(total.toFixed(2)), '', '', '', ''].join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="prelevements-emc-emc2-${from}-${to}.csv"`);
    res.send(`﻿${[head.join(';'), ...lines].join('\r\n')}`);
  }),
};
