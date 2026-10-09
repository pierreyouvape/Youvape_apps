const inventoryModel = require('../models/inventoryModel');
const inventoryPdaModel = require('../models/inventoryPdaModel');

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) {
      const { code, productId, barcode, choices } = error;
      return res.status(error.statusCode).json({ error: error.message, code, productId, barcode, choices });
    }
    console.error('[Inventaire]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

const id = (req) => Number(req.params.id);
const loc = (req) => Number(req.params.locationId);
const item = (req) => Number(req.params.itemId);

module.exports = {
  // ── PC ──
  options: handle(async (req, res) => res.json(await inventoryModel.options())),
  preview: handle(async (req, res) => res.json(await inventoryModel.preview(req.body || {}))),
  list: handle(async (req, res) => res.json({ inventories: await inventoryModel.list() })),
  create: handle(async (req, res) => res.json(await inventoryModel.create(req.body || {}, req.user.id))),
  get: handle(async (req, res) => res.json(await inventoryModel.get(id(req)))),
  releaseLocation: handle(async (req, res) => {
    await inventoryModel.releaseLocation(id(req), loc(req), req.user.id);
    res.json({ ok: true });
  }),
  releaseRecount: handle(async (req, res) => {
    await inventoryModel.releaseRecount(id(req), item(req), req.user.id);
    res.json({ ok: true });
  }),
  cancel: handle(async (req, res) => {
    await inventoryModel.cancel(id(req), req.user.id);
    res.json({ ok: true });
  }),

  // ── PDA ──
  current: handle(async (req, res) => res.json(await inventoryPdaModel.current(req.user.id))),
  findLocation: handle(async (req, res) => res.json(await inventoryPdaModel.findLocation(req.query.code))),
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
  listRecounts: handle(async (req, res) => res.json({ recounts: await inventoryPdaModel.listRecounts(req.user.id) })),
  getRecount: handle(async (req, res) => res.json(await inventoryPdaModel.getRecount(item(req), req.user.id))),
  takeRecount: handle(async (req, res) => res.json(await inventoryPdaModel.takeRecount(item(req), req.user.id))),
  scanRecount: handle(async (req, res) => res.json(await inventoryPdaModel.scanRecount(item(req), req.user.id, req.body?.code))),
  setRecountQty: handle(async (req, res) => res.json(await inventoryPdaModel.setRecountQty(item(req), req.user.id, req.body?.qty))),
  finishRecount: handle(async (req, res) => {
    await inventoryPdaModel.finishRecount(item(req), req.user.id);
    res.json({ ok: true });
  }),
};
