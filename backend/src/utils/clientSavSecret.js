const appConfigModel = require('../models/appConfigModel');

// Clé de stockage du secret de l'espace client SAV dans app_config.
const CLIENT_SAV_SECRET_KEY = 'client_sav_secret';

/**
 * Récupère le secret partagé de l'espace client SAV.
 *
 * Source de vérité : la table app_config (configurable depuis l'onglet DANGER
 * de l'app, sans toucher au .env). Repli sur la variable d'environnement
 * CLIENT_SAV_SECRET si rien n'est en base (compat / amorçage).
 *
 * @returns {Promise<string|null>} le secret, ou null si non configuré
 */
async function getClientSavSecret() {
  try {
    const row = await appConfigModel.get(CLIENT_SAV_SECRET_KEY);
    const fromDb = row && row.config_value ? String(row.config_value).trim() : '';
    if (fromDb) return fromDb;
  } catch (e) {
    console.warn('[clientSavSecret] Lecture app_config échouée, repli .env:', e.message);
  }
  const fromEnv = (process.env.CLIENT_SAV_SECRET || '').trim();
  return fromEnv || null;
}

module.exports = { getClientSavSecret, CLIENT_SAV_SECRET_KEY };
