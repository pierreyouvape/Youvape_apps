/**
 * Suivi des colis : réglage de la correspondance code transporteur → état,
 * et actualisation d'un colis à la demande.
 */

const trackingModel = require('../models/shipmentTrackingModel');
const trackingService = require('../services/shipmentTrackingService');
const { STATES } = require('../services/tracking/states');

const LOG_TAG = 'Suivi colis';
const SOURCES = { laposte: 'La Poste (Colissimo, Lettre suivie)', chronopost: 'Chronopost (et 2Shop)', mondial_relay: 'Mondial Relay' };

/** GET /api/shipments/tracking-map */
const getMap = async (req, res) => {
  try {
    res.json({ states: STATES, sources: SOURCES, rows: await trackingModel.getMap() });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur getMap :`, error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

/** PUT /api/shipments/tracking-map — { source, event_key, state } ; state vide = à classer */
const saveMapping = async (req, res) => {
  try {
    const { source, event_key: eventKey } = req.body || {};
    const state = req.body?.state || null;
    if (!SOURCES[source] || !eventKey) return res.status(400).json({ error: 'Source et code obligatoires' });

    const recomputed = await trackingModel.setMapping({ source, eventKey, state, userId: req.user?.id });
    if (recomputed === null) return res.status(404).json({ error: 'Code inconnu' });
    res.json({ success: true, recomputed });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur saveMapping :`, error.message);
    res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Erreur serveur' });
  }
};

/** POST /api/shipment-history/:id/tracking/refresh — le colis et son journal à jour. */
const refresh = async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Identifiant invalide' });
    const result = await trackingService.refreshLabel(id);
    if (!result) return res.status(404).json({ error: 'Colis introuvable' });
    res.json({ ...result, events: await trackingModel.eventsForLabel(id) });
  } catch (error) {
    console.error(`[${LOG_TAG}] Erreur refresh :`, error.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = { getMap, saveMapping, refresh };
