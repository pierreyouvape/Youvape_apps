const logistiqueService = require('../services/logistiqueService');

/**
 * Écran Réglages du Picking, section « Plugin WooCommerce — Logistique ».
 * Les réglages vivent dans WordPress : on ne fait que relayer, sans jamais
 * exposer les clés WooCommerce au navigateur.
 */

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    console.error('[Picking] Plugin logistique :', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

/** État du plugin et ses réglages, en un appel. `installed: false` = plugin absent ou inactif. */
const getPluginLogistique = handle(async (req, res) => {
  const [host, status, settings] = await Promise.all([
    logistiqueService.siteHost(),
    logistiqueService.getStatus(),
    logistiqueService.getSettings(),
  ]);
  if (!status.installed || !settings.installed) return res.json({ site: { host }, installed: false });
  res.json({ site: { host }, ...settings, status: status.status });
});

/** Mise à jour partielle : seules les clés envoyées changent, et seulement celles de l'expédition. */
const updatePluginLogistiqueSettings = handle(async (req, res) => {
  const patch = req.body;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Aucun réglage à enregistrer.' });
  }
  const refused = Object.keys(patch).filter(k => !logistiqueService.EDITABLE_SETTINGS.includes(k));
  if (refused.length) {
    return res.status(400).json({ error: `Réglage non modifiable depuis l'app : ${refused.join(', ')}.` });
  }

  const result = await logistiqueService.updateSettings(patch);
  if (!result.installed) {
    return res.status(503).json({ code: 'PLUGIN_ABSENT', error: 'Plugin non installé ou pas encore activé sur le site.' });
  }
  if (result.refused) {
    return res.status(422).json({ code: 'INVALID_SETTINGS', error: 'Réglages refusés par le plugin, rien n\'a été enregistré.', errors: result.errors });
  }
  console.log(`[Picking] Plugin logistique : réglages modifiés par ${req.user.email} (${Object.keys(patch).join(', ')})`);
  res.json({ settings: result.settings, warnings: result.warnings });
});

module.exports = { getPluginLogistique, updatePluginLogistiqueSettings };
