const appConfigModel = require('./appConfigModel');

// Clés app_config par fréquence
const KEYS = {
  daily:   'report_email_daily',
  weekly:  'report_email_weekly',
  monthly: 'report_email_monthly',
};

const FREQUENCIES = Object.keys(KEYS);

// Sépare une chaîne d'adresses (virgule, point-virgule, espace, retour ligne)
// en tableau d'emails nettoyés et dédupliqués.
function parseRecipients(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const parts = raw
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes('@'));
  return [...new Set(parts)];
}

const reportEmailModel = {
  KEYS,
  FREQUENCIES,
  parseRecipients,

  // Renvoie { daily: 'a@b.com, c@d.com', weekly: '', monthly: '' }
  getSettings: async () => {
    const out = {};
    for (const freq of FREQUENCIES) {
      const row = await appConfigModel.get(KEYS[freq]);
      out[freq] = row ? (row.config_value || '') : '';
    }
    return out;
  },

  // Enregistre une fréquence. Renvoie la chaîne normalisée stockée.
  setRecipients: async (freq, raw) => {
    if (!FREQUENCIES.includes(freq)) throw new Error(`Fréquence inconnue: ${freq}`);
    // On stocke une version normalisée (séparée par ", ") pour l'affichage.
    const normalized = parseRecipients(raw).join(', ');
    await appConfigModel.upsert(KEYS[freq], normalized);
    return normalized;
  },

  // Renvoie le tableau d'adresses pour une fréquence donnée.
  getRecipients: async (freq) => {
    const row = await appConfigModel.get(KEYS[freq]);
    return parseRecipients(row ? row.config_value : '');
  },
};

module.exports = reportEmailModel;
