/**
 * Stats d'expédition — voir models/shipmentStatsModel pour les règles de calcul.
 */

const shipmentStatsModel = require('../models/shipmentStatsModel');

/** GET / — ?from&to (AAAA-MM-JJ, jours de Paris inclus) */
const get = async (req, res) => {
  try {
    res.json(await shipmentStatsModel.get(req.query));
  } catch (error) {
    if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
    console.error('[ShipmentStats] Erreur :', error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { get };
