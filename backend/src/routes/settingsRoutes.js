const express = require('express');
const router = express.Router();
const appConfigModel = require('../models/appConfigModel');
const authMiddleware = require('../middleware/authMiddleware');
const { checkAdmin } = require('../middleware/permissionMiddleware');
const wcSyncService = require('../services/wcSyncService');

/*
 * Clés accessibles depuis l'app : la liste est FERMÉE, exprès.
 *
 * `app_config` mélange réglages et secrets (jetons, mots de passe SMTP, clés
 * transporteurs, URL de synchro). Sans cette liste, tout compte connecté lisait
 * les uns et les autres, et pouvait réécrire `wc_sync_wp_url` : le polling aurait
 * alors envoyé son jeton à une adresse de son choix (trouvé le 30/10/2026).
 *
 * La valeur de chaque entrée valide ce qui est enregistré. Toute autre clé
 * répond 404, en lecture comme en écriture, y compris pour un admin.
 */
const EXPOSED_SETTINGS = {
  wc_sync_interval: (value) => {
    const seconds = Number(value);
    return Number.isInteger(seconds) && seconds >= 0 && seconds <= 3600 ? String(seconds) : null;
  },
};

const isExposed = (key) => Object.prototype.hasOwnProperty.call(EXPOSED_SETTINGS, key);

router.use(authMiddleware, checkAdmin);

// GET /api/settings - Récupérer les paramètres exposés
router.get('/', async (req, res) => {
  try {
    const settings = {};
    for (const key of Object.keys(EXPOSED_SETTINGS)) {
      const config = await appConfigModel.get(key);
      if (config) settings[key] = config.config_value;
    }

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
router.get('/sync-health', async (req, res) => {
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
router.get('/:key', async (req, res) => {
  try {
    const config = isExposed(req.params.key) ? await appConfigModel.get(req.params.key) : null;

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
router.put('/:key', async (req, res) => {
  try {
    if (!isExposed(req.params.key)) {
      return res.status(404).json({ success: false, error: 'Setting not found' });
    }

    const value = EXPOSED_SETTINGS[req.params.key](req.body?.value);
    if (value === null) {
      return res.status(400).json({ success: false, error: 'Invalid value' });
    }

    const config = await appConfigModel.upsert(req.params.key, value);

    // Si l'intervalle de sync WC change, redémarrer le service
    if (req.params.key === 'wc_sync_interval') {
      await wcSyncService.restart();
      console.log(`🔄 WC Sync Service: Intervalle mis à jour (${value}s)`);
    }

    res.json({ success: true, config: { config_key: config.config_key, config_value: config.config_value } });
  } catch (error) {
    console.error('Error updating setting:', error);
    res.status(500).json({ success: false, error: 'Failed to update setting' });
  }
});

module.exports = router;
