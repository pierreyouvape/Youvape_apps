const pool = require('../config/database');
const inventoryModel = require('../models/inventoryModel');
const inventoryPdaModel = require('../models/inventoryPdaModel');
const inventorySpotModel = require('../models/inventorySpotModel');

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) {
      const { code, productId, barcode, choices, product, lines } = error;
      return res.status(error.statusCode).json({ error: error.message, code, productId, barcode, choices, product, lines });
    }
    console.error('[Inventaire]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

const id = (req) => Number(req.params.id);
const loc = (req) => Number(req.params.locationId);
const item = (req) => Number(req.params.itemId);
const pass = (req) => Number(req.params.passId);
const line = (req) => Number(req.params.lineId);

// Inventaire par emplacement : même liste, même fiche, autre modèle.
const isSpot = async (inventoryId) => {
  const { rows: [v] } = await pool.query('SELECT kind FROM inventories WHERE id = $1', [inventoryId]);
  return v?.kind === 'location';
};

module.exports = {
  // ── PC ──
  options: handle(async (req, res) => res.json(await inventoryModel.options())),
  preview: handle(async (req, res) => res.json(await inventoryModel.preview(req.body || {}))),
  list: handle(async (req, res) => res.json({ inventories: await inventoryModel.list() })),
  create: handle(async (req, res) => {
    const body = req.body || {};
    if (body.kind === 'location') return res.json(await inventorySpotModel.create(body.name, req.user.id));
    res.json(await inventoryModel.create(body, req.user.id));
  }),
  get: handle(async (req, res) => {
    res.json(await (await isSpot(id(req)) ? inventorySpotModel.detail(id(req)) : inventoryModel.get(id(req))));
  }),
  releaseLocation: handle(async (req, res) => {
    await inventoryModel.releaseLocation(id(req), loc(req), req.user.id);
    res.json({ ok: true });
  }),
  releaseRecount: handle(async (req, res) => {
    await inventoryModel.releaseRecount(id(req), item(req), req.user.id);
    res.json({ ok: true });
  }),
  cancel: handle(async (req, res) => {
    await (await isSpot(id(req)) ? inventorySpotModel.cancel(id(req), req.user.id) : inventoryModel.cancel(id(req), req.user.id));
    res.json({ ok: true });
  }),
  gaps: handle(async (req, res) => res.json({ gaps: await inventoryModel.gaps(id(req)) })),
  sendGaps: handle(async (req, res) => res.json(await inventoryModel.sendGaps(id(req), req.body?.itemIds, req.user.id))),
  retryGaps: handle(async (req, res) => res.json(await inventoryModel.retryGaps(id(req), req.body?.itemIds, req.user.id))),
  ignoreGaps: handle(async (req, res) => res.json(await inventoryModel.ignoreGaps(id(req), req.body?.itemIds, req.user.id))),
  unignoreGaps: handle(async (req, res) => res.json(await inventoryModel.unignoreGaps(id(req), req.body?.itemIds, req.user.id))),
  requestRecount: handle(async (req, res) => {
    await inventoryModel.requestRecount(id(req), item(req), req.user.id);
    res.json({ ok: true });
  }),
  fixLocation: handle(async (req, res) => {
    res.json(await inventoryModel.fixLocation(id(req), item(req), req.body?.location, req.user));
  }),
  // Pas « close » : c'est le nom de la fin d'emplacement côté PDA, plus bas —
  // la seconde clé écrasait la première (23/10/2026, « NaN » en clôturant).
  closeInventory: handle(async (req, res) => {
    await (await isSpot(id(req)) ? inventorySpotModel.close(id(req), req.user.id) : inventoryModel.close(id(req), req.user.id));
    res.json({ ok: true });
  }),
  spotAbandon: handle(async (req, res) => {
    await inventorySpotModel.abandon(pass(req), req.user.id, { inventoryId: id(req), anyone: true });
    res.json({ ok: true });
  }),
  spotRetry: handle(async (req, res) => res.json(await inventorySpotModel.retryLines(id(req), req.body?.lineIds, req.user.id))),
  spotIgnore: handle(async (req, res) => res.json(await inventorySpotModel.ignoreLines(id(req), req.body?.lineIds, req.user.id))),

  // ── PDA ──
  current: handle(async (req, res) => res.json(await inventoryPdaModel.current(req.user.id, req.query.inventory))),
  findLocation: handle(async (req, res) => {
    res.json(await inventoryPdaModel.findLocation(req.query.code, req.query.inventory));
  }),
  getLocation: handle(async (req, res) => res.json(await inventoryPdaModel.getLocation(loc(req), req.user.id))),
  take: handle(async (req, res) => res.json(await inventoryPdaModel.take(loc(req), req.user.id))),
  scan: handle(async (req, res) => {
    res.json(await inventoryPdaModel.scan(loc(req), req.user.id, req.body?.code, req.body?.productId));
  }),
  packQuantity: handle(async (req, res) => {
    await inventoryPdaModel.setPackQuantity(req.user.id, req.body?.code, Number(req.body?.productId), req.body?.quantity);
    res.json({ ok: true });
  }),
  setQty: handle(async (req, res) => {
    res.json(await inventoryPdaModel.setQty(loc(req), req.user.id, Number(req.params.productId), req.body?.qty));
  }),
  removeLine: handle(async (req, res) => {
    res.json(await inventoryPdaModel.removeLine(loc(req), req.user.id, Number(req.params.productId)));
  }),
  close: handle(async (req, res) => {
    await inventoryPdaModel.close(loc(req), req.user.id);
    res.json({ ok: true });
  }),
  reopen: handle(async (req, res) => res.json(await inventoryPdaModel.reopen(loc(req), req.user.id))),
  validateDay: handle(async (req, res) => res.json(await inventoryPdaModel.validateDay(req.user.id))),
  listRecounts: handle(async (req, res) => {
    res.json({ recounts: await inventoryPdaModel.listRecounts(req.user.id, req.query.inventory) });
  }),
  getRecount: handle(async (req, res) => res.json(await inventoryPdaModel.getRecount(item(req), req.user.id))),
  takeRecount: handle(async (req, res) => res.json(await inventoryPdaModel.takeRecount(item(req), req.user.id))),
  scanRecount: handle(async (req, res) => res.json(await inventoryPdaModel.scanRecount(item(req), req.user.id, req.body?.code))),
  setRecountQty: handle(async (req, res) => res.json(await inventoryPdaModel.setRecountQty(item(req), req.user.id, req.body?.qty))),
  finishRecount: handle(async (req, res) => {
    await inventoryPdaModel.finishRecount(item(req), req.user.id);
    res.json({ ok: true });
  }),

  // ── PDA : inventaire par emplacement ──
  spotCreate: handle(async (req, res) => res.json(await inventorySpotModel.create(req.body?.name, req.user.id))),
  spotHome: handle(async (req, res) => res.json(await inventorySpotModel.home(id(req), req.user.id))),
  spotOpen: handle(async (req, res) => res.json(await inventorySpotModel.openPass(id(req), req.body?.code, req.user.id))),
  spotGet: handle(async (req, res) => res.json(await inventorySpotModel.getPass(pass(req), req.user.id))),
  spotScan: handle(async (req, res) => {
    res.json(await inventorySpotModel.scan(pass(req), req.user.id, req.body?.code, req.body?.productId));
  }),
  spotAdd: handle(async (req, res) => {
    res.json(await inventorySpotModel.addProduct(pass(req), req.user.id, Number(req.body?.productId), req.body?.qty));
  }),
  spotSetQty: handle(async (req, res) => res.json(await inventorySpotModel.setQty(pass(req), req.user.id, line(req), req.body?.qty))),
  spotMove: handle(async (req, res) => res.json(await inventorySpotModel.moveLine(pass(req), req.user.id, line(req), req.body?.code))),
  spotRemove: handle(async (req, res) => res.json(await inventorySpotModel.removeLine(pass(req), req.user.id, line(req)))),
  spotValidate: handle(async (req, res) => res.json(await inventorySpotModel.validate(pass(req), req.user.id))),
  spotAbandonMine: handle(async (req, res) => {
    await inventorySpotModel.abandon(pass(req), req.user.id);
    res.json({ ok: true });
  }),
};
