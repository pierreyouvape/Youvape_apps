const pdaProductModel = require('../models/pdaProductModel');

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('[PDA Produit]', error.message);
    res.status(500).json({ error: error.message || 'Erreur serveur' });
  }
};

const id = (req) => Number(req.params.id);

module.exports = {
  search: handle(async (req, res) => {
    res.json(await pdaProductModel.search(req.query.q));
  }),
  locations: handle(async (req, res) => {
    res.json({ locations: await pdaProductModel.listLocations() });
  }),
  reasons: handle(async (req, res) => {
    res.json({ reasons: Object.entries(pdaProductModel.REASONS).map(([key, r]) => ({ key, label: r.label, directions: r.directions })) });
  }),
  get: handle(async (req, res) => {
    res.json(await pdaProductModel.getProduct(id(req)));
  }),
  setLocation: handle(async (req, res) => {
    res.json(await pdaProductModel.setLocation(id(req), req.body?.location, req.user));
  }),
  addBarcode: handle(async (req, res) => {
    res.json(await pdaProductModel.addBarcode(id(req), req.body || {}, req.user));
  }),
  editBarcode: handle(async (req, res) => {
    res.json(await pdaProductModel.editBarcode(id(req), Number(req.params.barcodeId), req.body || {}, req.user));
  }),
  deleteBarcode: handle(async (req, res) => {
    res.json(await pdaProductModel.deleteBarcode(id(req), Number(req.params.barcodeId), req.user));
  }),
  createMovement: handle(async (req, res) => {
    res.json(await pdaProductModel.createMovement(id(req), req.body || {}, req.user));
  }),
};
