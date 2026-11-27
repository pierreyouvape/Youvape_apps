/**
 * Transferts de stock site ↔ boutiques (app « Transferts », droit `transferts`).
 * Monté sur /api/transferts : JWT + droit dans le routeur.
 */

const model = require('../models/stockTransferModel');
const { resolveWarehouse } = require('../config/nextore');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (!error.statusCode) console.error('[Transferts]', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur', problems: error.problems || null });
  }
};

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const frNum = (v) => (v == null ? '' : String(v).replace('.', ','));

module.exports = {
  list: handle(async (req, res) => {
    const wh = req.query.shop ? resolveWarehouse(req.query.shop) : null;
    res.json(await model.list({
      warehouseId: wh?.id || null,
      direction: ['site_to_shop', 'shop_to_site'].includes(req.query.direction) ? req.query.direction : null,
      from: ISO_DATE.test(req.query.from || '') ? req.query.from : null,
      to: ISO_DATE.test(req.query.to || '') ? req.query.to : null,
    }));
  }),

  get: handle(async (req, res) => res.json(await model.get(req.params.id))),

  create: handle(async (req, res) => {
    const { direction, shop, note } = req.body || {};
    const wh = resolveWarehouse(shop);
    if (!wh) return res.status(400).json({ error: 'Boutique inconnue.' });
    res.status(201).json(await model.createDraft({ direction, warehouseId: wh.id, note, userId: req.user.id }));
  }),

  update: handle(async (req, res) => res.json(await model.updateDraft(req.params.id, req.body || {}))),

  cancel: handle(async (req, res) => {
    await model.cancelDraft(req.params.id);
    res.json({ ok: true });
  }),

  lookup: handle(async (req, res) => res.json(await model.lookup(req.params.id, req.query.q))),

  setLine: handle(async (req, res) => {
    res.json(await model.setLine(req.params.id, req.params.productId, (req.body || {}).qty));
  }),

  send: handle(async (req, res) => res.json(await model.send(req.params.id, req.user))),

  retryOrder: handle(async (req, res) => res.json(await model.createDestinationOrder(req.params.id, req.user))),

  resolveOut: handle(async (req, res) => {
    res.json(await model.resolveOut(req.params.id, req.params.itemId, (req.body || {}).action));
  }),

  exportCsv: handle(async (req, res) => {
    const { from, to } = req.query;
    if (!ISO_DATE.test(from || '') || !ISO_DATE.test(to || '')) return res.status(400).json({ error: 'Période invalide.' });
    const rows = await model.exportRows(from, to);
    const head = ['Date', 'Mois', 'Transfert', 'Sens', 'Catégorie', 'Marque', 'SKU', 'Produit',
      'Quantité site', 'Pièces boutique', 'Coût unitaire HT (site)', 'Total HT', 'Sortie du stock', 'Par'];
    const lines = rows.map((r) => [
      r.date, r.month, r.reference, r.label, r.category, r.brand, r.sku, r.name,
      r.qty_site, r.qty_shop, frNum(r.unit_cost_ht), frNum(r.total_ht),
      r.out_status === 'sent' ? 'faite' : r.out_status, r.user_name,
    ].map(csvCell).join(';'));
    const total = rows.reduce((s, r) => s + Number(r.total_ht || 0), 0);
    lines.push(['', '', '', '', '', '', '', 'TOTAL', '', '', '', frNum(total.toFixed(2)), '', ''].join(';'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="transferts-${from}-${to}.csv"`);
    res.send(`﻿${[head.join(';'), ...lines].join('\r\n')}`);
  }),
};
