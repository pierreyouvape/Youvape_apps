const express = require('express');
const router = express.Router();
const appConfigModel = require('../models/appConfigModel');
const authMiddleware = require('../middleware/authMiddleware');
const wcSyncService = require('../services/wcSyncService');

// GET /api/settings - Récupérer tous les paramètres
router.get('/', authMiddleware, async (req, res) => {
  try {
    const configs = await appConfigModel.getAll();

    // Transformer en objet clé-valeur
    const settings = {};
    configs.forEach(config => {
      settings[config.config_key] = config.config_value;
    });

    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
});

/*
 * GET /api/settings/sync-health - Fraîcheur de la synchronisation WooCommerce.
 *
 * ⚠️ DOIT rester déclarée AVANT `GET /:key`, qui capturerait sinon
 * « sync-health » comme une clé de configuration et renverrait 404.
 *
 * Répond à la question que les logs seuls ne permettaient pas de trancher :
 * « les données sont-elles à jour ? ». Les valeurs viennent d'app_config, donc
 * elles survivent aux rebuilds Docker.
 */
router.get('/sync-health', authMiddleware, async (req, res) => {
  try {
    const read = async (key) => (await appConfigModel.get(key))?.config_value || null;

    const [status, lastPollOkAt, lastEventAt, lastBatchSize, lastErrorRaw, intervalRaw] =
      await Promise.all([
        read('wc_sync_status'),
        read('wc_sync_last_poll_ok_at'),
        read('wc_sync_last_event_at'),
        read('wc_sync_last_batch_size'),
        read('wc_sync_last_error'),
        read('wc_sync_interval'),
      ]);

    const intervalSeconds = parseInt(intervalRaw, 10) || 60;

    const secondsSinceLastPoll = lastPollOkAt
      ? Math.round((Date.now() - new Date(lastPollOkAt).getTime()) / 1000)
      : null;

    // Périmé au-delà de 5 intervalles, avec un plancher de 5 minutes : en deçà,
    // un simple poll un peu long déclencherait une fausse alerte.
    const staleAfter = Math.max(intervalSeconds * 5, 300);
    const stale = secondsSinceLastPoll === null || secondsSinceLastPoll > staleAfter;

    let lastError = null;
    if (lastErrorRaw) {
      try { lastError = JSON.parse(lastErrorRaw); } catch { lastError = { message: lastErrorRaw }; }
    }

    res.json({
      success: true,
      health: {
        status: status || 'unknown',
        healthy: status === 'running' && !stale && !lastError,
        stale,
        staleAfterSeconds: staleAfter,
        intervalSeconds,
        lastPollOkAt,
        secondsSinceLastPoll,
        lastEventAt,
        lastBatchSize: lastBatchSize === null ? null : parseInt(lastBatchSize, 10),
        lastError,
      },
    });
  } catch (error) {
    console.error('Error fetching sync health:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch sync health' });
  }
});

// GET /api/settings/:key - Récupérer un paramètre spécifique
router.get('/:key', authMiddleware, async (req, res) => {
  try {
    const config = await appConfigModel.get(req.params.key);

    if (!config) {
      return res.status(404).json({ success: false, error: 'Setting not found' });
    }

    res.json({ success: true, value: config.config_value });
  } catch (error) {
    console.error('Error fetching setting:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch setting' });
  }
});

// PUT /api/settings/:key - Mettre à jour un paramètre
router.put('/:key', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body;

    if (value === undefined) {
      return res.status(400).json({ success: false, error: 'Value is required' });
    }

    const config = await appConfigModel.upsert(req.params.key, String(value));

    // Si l'intervalle de sync WC change, redémarrer le service
    if (req.params.key === 'wc_sync_interval') {
      await wcSyncService.restart();
      console.log(`🔄 WC Sync Service: Intervalle mis à jour (${value}s)`);
    }

    res.json({ success: true, config });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

module.exports = router;
