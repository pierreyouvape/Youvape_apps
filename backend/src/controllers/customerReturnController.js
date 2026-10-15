const customerReturnModel = require('../models/customerReturnModel');

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('[Retours]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

const id = (req) => Number(req.params.id);

module.exports = {
  list: handle(async (req, res) => res.json(await customerReturnModel.list(req.query))),
  orderContext: handle(async (req, res) => {
    res.json(await customerReturnModel.orderContext(Number(req.params.wpOrderId), Number(req.query.exclude) || null));
  }),
  update: handle(async (req, res) => res.json(await customerReturnModel.update(id(req), req.body || {}, req.user))),
  create: handle(async (req, res) => res.json(await customerReturnModel.create(req.body || {}, req.user))),
  get: handle(async (req, res) => res.json(await customerReturnModel.get(id(req)))),
  validate: handle(async (req, res) => {
    res.json(await customerReturnModel.validate(id(req), req.body?.destinations, req.user));
  }),
  restock: handle(async (req, res) => res.json(await customerReturnModel.retryRestock(id(req), req.user))),
  treat: handle(async (req, res) => res.json(await customerReturnModel.treat(id(req), req.body || {}, req.user))),
  cancel: handle(async (req, res) => res.json(await customerReturnModel.cancel(id(req), req.user))),
  productStock: handle(async (req, res) => res.json(await customerReturnModel.productStock(Number(req.params.productId)))),
  replacementPreview: handle(async (req, res) => res.json(await customerReturnModel.replacementPreview(id(req)))),
  createReplacement: handle(async (req, res) => {
    res.json(await customerReturnModel.createReplacement(id(req), req.body?.items, req.user));
  }),
  setPartial: handle(async (req, res) => {
    res.json(await customerReturnModel.setPartial(id(req), Number(req.params.lineId), req.body || {}, req.user));
  }),
  cancelOutcome: handle(async (req, res) => res.json(await customerReturnModel.cancelOutcome(id(req), req.user))),
  reship: handle(async (req, res) => res.json(await customerReturnModel.reship(id(req), req.user))),
  creditPoints: handle(async (req, res) => res.json(await customerReturnModel.creditPoints(id(req), req.body || {}, req.user))),
  linkRefund: handle(async (req, res) => {
    res.json(await customerReturnModel.linkRefund(id(req), Number(req.body?.wpRefundId), req.user));
  }),
  createLabel: handle(async (req, res) => res.json(await customerReturnModel.createLabel(id(req), req.body || {}, req.user))),
  getLabel: handle(async (req, res) => {
    const { buffer, mime, filename } = await customerReturnModel.getLabel(id(req));
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }),

  searchProducts: handle(async (req, res) => res.json({ products: await customerReturnModel.searchProducts(req.query.q) })),
  productLots: handle(async (req, res) => res.json({ lots: await customerReturnModel.productLots(Number(req.query.productId)) })),
  createBoutiqueItem: handle(async (req, res) => res.json(await customerReturnModel.createBoutiqueItem(req.body || {}, req.user))),
  setItemLot: handle(async (req, res) => {
    res.json(await customerReturnModel.setItemLot(Number(req.params.itemId), Number(req.body?.purchaseOrderId)));
  }),
  deleteBoutiqueItem: handle(async (req, res) => res.json(await customerReturnModel.deleteBoutiqueItem(Number(req.params.itemId)))),

  supplierSummary: handle(async (req, res) => res.json({ suppliers: await customerReturnModel.supplierSummary() })),
  supplierItems: handle(async (req, res) => res.json(await customerReturnModel.supplierItems(Number(req.params.supplierId)))),
  createBatch: handle(async (req, res) => {
    res.json(await customerReturnModel.createBatch(Number(req.params.supplierId), req.body?.itemIds, req.user));
  }),
  linkCredit: handle(async (req, res) => {
    res.json(await customerReturnModel.linkCredit(Number(req.params.batchId), Number(req.body?.documentId), req.user));
  }),
  unlinkCredit: handle(async (req, res) => {
    res.json(await customerReturnModel.unlinkCredit(Number(req.params.batchId), Number(req.params.documentId)));
  }),
  exportBatch: handle(async (req, res) => {
    const { buffer, filename } = await customerReturnModel.exportBatch(Number(req.params.batchId));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  }),
};
