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
