const logistiqueService = require('../services/logistiqueService');
const pool = require('../config/database');

/**
 * Paramètres généraux, onglet WooCommerce : réglages du plugin youvape-logistique.
 * Les réglages vivent dans WordPress : on ne fait que relayer, sans jamais
 * exposer les clés WooCommerce au navigateur.
 */

const handle = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (error) {
    console.error('[Plugin logistique]', error.message);
    res.status(error.statusCode || 500).json({ error: error.message || 'Erreur serveur' });
  }
};

/**
 * Connexion, état du plugin et réglages, en un appel. `installed: false` = plugin
 * absent ou inactif. Un site injoignable n'est pas une erreur HTTP : l'écran doit
 * rester utilisable, c'est lui qui permet de corriger la connexion.
 */
const getPluginLogistique = handle(async (req, res) => {
  const [conn, toShip, knownStatuses] = await Promise.all([
    logistiqueService.getConnection(),
    logistiqueService.getToShipStatuses(),
    knownOrderStatuses(),
  ]);
  // Le réglage « à expédier » est à nous : il s'affiche même sans plugin ni connexion.
  const app = {
    to_ship_statuses: toShip,
    to_ship_default: logistiqueService.DEFAULT_TO_SHIP,
    known_statuses: knownStatuses,
  };
  if (!conn.configured) return res.json({ connection: conn, app, installed: false });
  try {
    const [status, settings] = await Promise.all([logistiqueService.getStatus(), logistiqueService.getSettings()]);
    if (!status.installed || !settings.installed) return res.json({ connection: conn, app, installed: false });
    res.json({ connection: conn, app, ...settings, status: status.status });
  } catch (error) {
    if (!error.statusCode) throw error;
    res.json({ connection: conn, app, installed: false, site_error: error.message });
  }
});

/** Statuts vus dans nos commandes, sans « wc- » ni statuts interdits : choix proposés sans le plugin. */
const knownOrderStatuses = async () => {
  const { rows } = await pool.query("SELECT DISTINCT regexp_replace(post_status, '^wc-', '') AS slug FROM orders WHERE post_status LIKE 'wc-%' ORDER BY 1");
  return rows.map(r => r.slug).filter(s => !logistiqueService.FORBIDDEN_STATUSES.includes(s));
};

/** Statuts « à expédier » : réglage de l'app, enregistré chez nous. */
const saveToShipStatuses = handle(async (req, res) => {
  const result = await logistiqueService.saveToShipStatuses(req.body?.statuses);
  if (result.errors) return res.status(400).json({ error: 'Statuts refusés, rien n\'a été enregistré.', errors: result.errors });
  console.log(`[Plugin logistique] Statuts à expédier modifiés par ${req.user.email} : ${result.statuses.join(', ')}`);
  res.json({ to_ship_statuses: result.statuses });
});

/** Le site visé par le plugin : champ secret vide = valeur gardée, tant que l'adresse ne change pas. */
const savePluginLogistiqueConnection = handle(async (req, res) => {
  const result = await logistiqueService.saveConnection(req.body);
  if (result.errors) return res.status(400).json({ error: 'Connexion refusée, rien n\'a été enregistré.', errors: result.errors });
  console.log(`[Plugin logistique] Connexion modifiée par ${req.user.email} : ${result.connection.host}`);
  res.json({ connection: result.connection });
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
  console.log(`[Plugin logistique] Réglages modifiés par ${req.user.email} (${Object.keys(patch).join(', ')})`);
  res.json({ settings: result.settings, warnings: result.warnings });
});

module.exports = { getPluginLogistique, savePluginLogistiqueConnection, saveToShipStatuses, updatePluginLogistiqueSettings };
