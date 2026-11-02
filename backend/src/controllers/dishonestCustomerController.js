/**
 * Signalement « client ayant été malhonnête », depuis la fiche client.
 * Lecture : tout compte connecté (montage /api/customers). Signaler et retirer :
 * droit tickets en écriture (customersRoutes).
 */

const dishonestCustomerModel = require('../models/dishonestCustomerModel');

const wpUserIdOf = (req) => {
  const id = String(req.params.id || '');
  return /^\d+$/.test(id) ? id : null;
};

const fail = (res, error) => {
  if (!error.statusCode) console.error('[Clients signalés]', error);
  res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Erreur serveur' });
};

/** GET /api/customers/:id/dishonest-flag */
exports.get = async (req, res) => {
  const id = wpUserIdOf(req);
  if (!id) return res.status(400).json({ success: false, error: 'Client invalide.' });
  try {
    res.json({ success: true, data: await dishonestCustomerModel.forCustomer(id) });
  } catch (error) {
    fail(res, error);
  }
};

/** POST /api/customers/:id/dishonest-flag — body { reason } */
exports.flag = async (req, res) => {
  const id = wpUserIdOf(req);
  if (!id) return res.status(400).json({ success: false, error: 'Client invalide.' });
  try {
    await dishonestCustomerModel.flagCustomer(id, req.body?.reason, req.user?.id);
    res.json({ success: true, data: await dishonestCustomerModel.forCustomer(id) });
  } catch (error) {
    fail(res, error);
  }
};

/** DELETE /api/customers/:id/dishonest-flag — le signalement reste en historique. */
exports.unflag = async (req, res) => {
  const id = wpUserIdOf(req);
  if (!id) return res.status(400).json({ success: false, error: 'Client invalide.' });
  try {
    await dishonestCustomerModel.unflagCustomer(id, req.user?.id);
    res.json({ success: true, data: await dishonestCustomerModel.forCustomer(id) });
  } catch (error) {
    fail(res, error);
  }
};
