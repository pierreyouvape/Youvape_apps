/**
 * Client du plugin WordPress `youvape-logistique` (dossier du même nom à la
 * racine du dépôt) : ce qui remplacera les écritures de BMS dans WooCommerce.
 *
 * Pour l'instant, seuls ses RÉGLAGES sont lus et modifiés, depuis l'écran
 * Réglages du Picking. Ils vivent dans WordPress (une option du plugin), rien
 * n'est gardé chez nous. Les clés WooCommerce ne quittent jamais le backend.
 *
 * Plugin absent ou inactif (404 `rest_no_route`) : c'est le cas normal jusqu'à
 * la bascule hors BMS, on le dit (`installed: false`) sans en faire une erreur.
 *
 * ⚠️ Comme pour WPLoyalty, on ne juge jamais un appel sur son seul statut
 * HTTP : un 200 dont le corps n'a pas la forme attendue (page de maintenance,
 * pare-feu…) est une erreur.
 */

const axios = require('axios');
const pool = require('../config/database');

const PLUGIN_NAMESPACE = 'wc-youvape-logistique/v1';

// Les réglages que l'app a le droit de modifier : ceux de l'expédition.
// `restock_refunded_items_default` (case de l'écran de remboursement) n'a rien
// à faire ici et reste à sa valeur du plugin.
const EDITABLE_SETTINGS = [
  'ship_target_statuses', 'ship_from_statuses', 'ship_keep_statuses',
  'status_target_statuses', 'status_from_statuses',
  'meta_keys', 'write_bms_meta', 'bms_meta_keys', 'bms_tracking_link_template',
  'batch_max', 'time_budget',
];

const serviceError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });

/**
 * Le site visé et ses clés. Tout passe par ici : pointer le client sur la
 * copie de test du site ne demandera que de changer cette fonction.
 */
const connection = async () => {
  const { rows: [cfg] } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret, htaccess_user, htaccess_password FROM rewards_config LIMIT 1'
  );
  if (!cfg?.woocommerce_url || !cfg.consumer_key) throw serviceError('Identifiants WooCommerce non configurés (Récompense Avis).', 503);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.htaccess_user && cfg.htaccess_password) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.htaccess_user}:${cfg.htaccess_password}`).toString('base64')}`;
  }
  const baseUrl = cfg.woocommerce_url.replace(/\/$/, '');
  return {
    baseUrl,
    host: new URL(baseUrl).host,
    options: {
      params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
      headers,
      timeout: 15000,
    },
  };
};

const isNoRoute = (error) => error?.response?.status === 404 && error.response.data?.code === 'rest_no_route';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Une erreur du site, dite lisiblement. Ne renvoie jamais l'URL appelée : elle porte les clés.
const siteError = (error) => {
  const status = error?.response?.status;
  const data = error?.response?.data;
  if (status === 401 || status === 403) {
    return serviceError('Clés WooCommerce refusées par le site (il faut un compte ayant le droit manage_woocommerce).');
  }
  if (status === 503 && isObject(data) && data.message) return serviceError(`Plugin : ${data.message}`);
  if (status) return serviceError(`Le site a répondu HTTP ${status}${isObject(data) && data.message ? ` : ${data.message}` : ''}.`);
  return serviceError(`Site injoignable (${error.code || error.message}).`);
};

const request = async (method, path, body) => {
  const { baseUrl, options } = await connection();
  const { data } = await axios({ method, url: `${baseUrl}/wp-json/${PLUGIN_NAMESPACE}${path}`, data: body, ...options });
  return data;
};

/** @returns {{ installed: false } | { installed: true, status: object }} */
const getStatus = async () => {
  try {
    const data = await request('get', '/status');
    if (!isObject(data) || typeof data.version !== 'string' || typeof data.tables_ready !== 'boolean') {
      throw serviceError('Réponse inattendue du site pour l\'état du plugin.');
    }
    return { installed: true, status: data };
  } catch (error) {
    if (isNoRoute(error)) return { installed: false };
    if (error.statusCode) throw error;
    throw siteError(error);
  }
};

// WordPress encode un tableau PHP vide en liste JSON `[]` : on le ramène à un objet.
const asMap = (v) => (isObject(v) ? v : {});

const checkSettings = (settings) => {
  if (!isObject(settings) || !EDITABLE_SETTINGS.every(k => k in settings)) {
    throw serviceError('Réponse inattendue du site pour les réglages du plugin.');
  }
  return settings;
};

/**
 * @returns {{ installed: false } | { installed: true, settings, defaults,
 *   forbidden_statuses: string[], registered_statuses: Object<string,string> }}
 */
const getSettings = async () => {
  try {
    const data = await request('get', '/settings');
    if (!isObject(data) || !Array.isArray(data.forbidden_statuses)) {
      throw serviceError('Réponse inattendue du site pour les réglages du plugin.');
    }
    return {
      installed: true,
      settings: checkSettings(data.settings),
      defaults: checkSettings(data.defaults),
      forbidden_statuses: data.forbidden_statuses,
      registered_statuses: asMap(data.registered_statuses),
    };
  } catch (error) {
    if (isNoRoute(error)) return { installed: false };
    if (error.statusCode) throw error;
    throw siteError(error);
  }
};

/**
 * Mise à jour PARTIELLE : seules les clés envoyées changent. Le plugin refuse
 * tout le lot à la première valeur invalide.
 * @returns {{ installed: false }
 *   | { installed: true, refused: true, errors: string[] }
 *   | { installed: true, refused: false, settings, warnings: string[] }}
 */
const updateSettings = async (patch) => {
  try {
    const data = await request('post', '/settings', patch);
    if (!isObject(data) || !Array.isArray(data.warnings)) {
      throw serviceError('Réponse inattendue du site après l\'enregistrement : vérifier les réglages en rechargeant.');
    }
    return { installed: true, refused: false, settings: checkSettings(data.settings), warnings: data.warnings };
  } catch (error) {
    if (isNoRoute(error)) return { installed: false };
    const data = error?.response?.data;
    if (error?.response?.status === 400 && data?.code === 'INVALID_SETTINGS') {
      const errors = Array.isArray(data.data?.errors) && data.data.errors.length ? data.data.errors : [data.message];
      return { installed: true, refused: true, errors };
    }
    if (error.statusCode) throw error;
    throw siteError(error);
  }
};

const siteHost = async () => (await connection()).host;

module.exports = { getStatus, getSettings, updateSettings, siteHost, EDITABLE_SETTINGS, PLUGIN_NAMESPACE };
