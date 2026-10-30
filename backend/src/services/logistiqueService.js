/**
 * Client du plugin WordPress `youvape-logistique` (dossier du même nom à la
 * racine du dépôt) : ce qui remplacera les écritures de BMS dans WooCommerce.
 *
 * Pour l'instant, seuls ses RÉGLAGES sont lus et modifiés, depuis les
 * Paramètres généraux (onglet WooCommerce). Ils vivent dans WordPress (une option du plugin), rien
 * n'est gardé chez nous. Les clés WooCommerce ne quittent jamais le backend.
 *
 * Le site visé a sa propre connexion, dans `app_config` et modifiable depuis le
 * même écran : pointer vers la préprod ne touche ni aux points fidélité
 * (`rewards_config`) ni à la synchro.
 *
 * Plugin absent ou inactif (404 `rest_no_route`) : c'est le cas normal jusqu'à
 * la bascule hors BMS, on le dit (`installed: false`) sans en faire une erreur.
 *
 * ⚠️ Comme pour WPLoyalty, on ne juge jamais un appel sur son seul statut
 * HTTP : un 200 dont le corps n'a pas la forme attendue (page de maintenance,
 * pare-feu…) est une erreur.
 */

const axios = require('axios');
const appConfigModel = require('../models/appConfigModel');

const PLUGIN_NAMESPACE = 'wc-youvape-logistique/v1';
// Jamais dans EXPOSED_SETTINGS : cette entrée porte des secrets.
const CONNECTION_KEY = 'logistique_connection';

// Les réglages que l'app a le droit de modifier : ceux de l'expédition.
const EDITABLE_SETTINGS = [
  'ship_target_statuses', 'ship_from_statuses', 'ship_keep_statuses',
  'status_target_statuses', 'status_from_statuses',
  'meta_keys',
  'batch_max', 'time_budget',
];

const serviceError = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const readConnection = async () => {
  const row = await appConfigModel.get(CONNECTION_KEY);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.config_value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/** Ce que l'écran a le droit de voir : jamais une clé ni un mot de passe. */
const publicConnection = (cfg) => ({
  configured: !!(cfg?.url && cfg.consumer_key && cfg.consumer_secret),
  url: cfg?.url || '',
  host: cfg?.url ? new URL(cfg.url).host : null,
  consumer_key_set: !!cfg?.consumer_key,
  consumer_secret_set: !!cfg?.consumer_secret,
  htaccess_user: cfg?.htaccess_user || '',
  htaccess_password_set: !!cfg?.htaccess_password,
});

const cleanUrl = (value) => {
  let url;
  try {
    url = new URL(String(value ?? '').trim());
  } catch {
    return null;
  }
  // https seulement : les clés voyagent dans l'adresse, et le certificat est toujours vérifié.
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

/**
 * Applique une saisie sur la connexion enregistrée. Un champ secret vide veut
 * dire « ne pas y toucher », SAUF si l'adresse change : il faut alors tout
 * ressaisir, pour que les clés d'un site ne partent jamais vers un autre.
 * @returns {{ connection: object } | { errors: string[] }}
 */
const mergeConnection = (current, input) => {
  const errors = [];
  const url = cleanUrl(input?.url);
  if (!url) errors.push('Adresse du site invalide : https://… sans identifiant ni paramètre.');

  const sameSite = !!current?.url && url === current.url;
  const kept = (field) => String(input?.[field] ?? '').trim() || (sameSite ? current[field] : '') || '';
  const consumer_key = kept('consumer_key');
  const consumer_secret = kept('consumer_secret');
  const htaccess_user = String(input?.htaccess_user ?? '').trim();
  const htaccess_password = htaccess_user ? kept('htaccess_password') : '';

  if (url && current?.url && !sameSite && !(input?.consumer_key && input?.consumer_secret)) {
    errors.push('L\'adresse change : ressaisir la clé et le secret de ce site.');
  } else if (!consumer_key || !consumer_secret) {
    errors.push('La clé et le secret WooCommerce sont obligatoires.');
  }
  if (consumer_key && !consumer_key.startsWith('ck_')) errors.push('La clé WooCommerce commence par ck_.');
  if (consumer_secret && !consumer_secret.startsWith('cs_')) errors.push('Le secret WooCommerce commence par cs_.');
  if (htaccess_user && !htaccess_password) errors.push('Mot de passe du site manquant pour cet identifiant.');

  if (errors.length) return { errors };
  return { connection: { url, consumer_key, consumer_secret, htaccess_user, htaccess_password } };
};

const getConnection = async () => publicConnection(await readConnection());

/** @returns {{ errors: string[] } | { connection: object }} la vue publique, sans secret */
const saveConnection = async (input) => {
  const merged = mergeConnection(await readConnection(), input);
  if (merged.errors) return merged;
  await appConfigModel.upsert(CONNECTION_KEY, JSON.stringify(merged.connection));
  return { connection: publicConnection(merged.connection) };
};

/** Le site visé et ses clés : le seul endroit qui les lit pour appeler le plugin. */
const connection = async () => {
  const cfg = await readConnection();
  if (!publicConnection(cfg).configured) throw serviceError('Connexion au site non renseignée.', 503);
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.htaccess_user && cfg.htaccess_password) {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.htaccess_user}:${cfg.htaccess_password}`).toString('base64')}`;
  }
  return {
    baseUrl: cfg.url,
    options: {
      params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
      headers,
      timeout: 15000,
    },
  };
};

const isNoRoute = (error) => error?.response?.status === 404 && error.response.data?.code === 'rest_no_route';

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

module.exports = {
  getStatus, getSettings, updateSettings, getConnection, saveConnection, mergeConnection,
  EDITABLE_SETTINGS, PLUGIN_NAMESPACE,
};
