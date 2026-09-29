/**
 * Stats d'expédition — voir models/shipmentStatsModel pour les règles de calcul.
 */

const shipmentStatsModel = require('../models/shipmentStatsModel');

const fail = (res, error, where) => {
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  console.error(`[ShipmentStats] Erreur ${where} :`, error.message);
  return res.status(500).json({ error: 'Erreur serveur' });
};

/** GET / — ?from&to (AAAA-MM-JJ, jours de Paris inclus) */
const get = async (req, res) => {
  try {
    res.json(await shipmentStatsModel.get(req.query));
  } catch (error) {
    fail(res, error, 'get');
  }
};

/** GET /packers — noms BMS et leur compte de l'app. */
const listPackers = async (req, res) => {
  try {
    res.json(await shipmentStatsModel.listPackers());
  } catch (error) {
    fail(res, error, 'listPackers');
  }
};

/** PUT /packers — { packerName, userId } ; userId nul = détacher. */
const setPacker = async (req, res) => {
  try {
    const packerName = String(req.body?.packerName || '').trim();
    if (!packerName) return res.status(400).json({ error: 'Nom BMS manquant' });
    const userId = req.body?.userId ? parseInt(req.body.userId, 10) : null;
    await shipmentStatsModel.setPacker(packerName, userId || null, req.user?.id || null);
    res.json({ success: true });
  } catch (error) {
    fail(res, error, 'setPacker');
  }
};

module.exports = { get, listPackers, setPacker };
