/**
 * Points fidélité WPLoyalty, pour les Retours (avoir client, 100 pts = 1 €)
 * et les récompenses d'avis (rewardService).
 *
 * Passe par le plugin `youvape-loyalty` (dossier du même nom à la racine du
 * dépôt), qui enregistre le crédit sous NOTRE type d'action (« Avoir retour
 * SAV », « Avis partagé ») avec son motif et le n° de commande. L'API REST de
 * WPLoyalty, elle, range tout sous « REST API » et ignore tout le reste
 * (vérifié le 15/10/2026).
 *
 * Tant que le plugin n'est pas installé (404 `rest_no_route`), repli sur
 * l'API WPLoyalty d'origine — sans motif.
 */

const axios = require('axios');
const pool = require('../config/database');

const PLUGIN_NAMESPACE = 'wc-youvape-loyalty/v1';

let fallbackLogged = false;

const connection = async () => {
  const { rows: [cfg] } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret FROM rewards_config LIMIT 1'
  );
  if (!cfg?.woocommerce_url || !cfg.consumer_key) throw new Error('Identifiants WooCommerce non configurés (Récompense Avis).');
  return {
    baseUrl: cfg.woocommerce_url.replace(/\/$/, ''),
    options: {
      params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    },
  };
};

// La route n'existe pas sur le site : plugin non installé ou désactivé.
const isNoRoute = (error) => error?.response?.status === 404 && error.response.data?.code === 'rest_no_route';

// ⚠️ L'API WPLoyalty répond HTTP 200 même quand elle échoue (client inconnu,
// solde insuffisant…) : seul `success` le dit.
const checkWployaltyResponse = (data) => {
  if (data?.success !== true) throw new Error(data?.data?.message || 'WPLoyalty a refusé l\'opération.');
  return data;
};

/**
 * @param {'add'|'reduce'} action
 * @param {{ type: 'avoir'|'avis', note: string, orderId?: number }} reason
 * @returns {{ points: number, requested: number, via: 'plugin'|'wployalty' }}
 *   `points` = points réellement crédités / retirés (un retrait est plafonné au solde).
 */
const call = async (action, email, points, { type, note, orderId }) => {
  const { baseUrl, options } = await connection();
  const orderNumber = Number(orderId);
  try {
    const { data } = await axios.post(
      `${baseUrl}/wp-json/${PLUGIN_NAMESPACE}/points/${action}`,
      { user_email: email, points, type, note, ...(orderNumber > 0 ? { order_id: orderNumber } : {}) },
      options
    );
    return { ...data, via: 'plugin' };
  } catch (error) {
    if (!isNoRoute(error)) throw error;
  }
  if (!fallbackLogged) {
    console.warn('[Loyalty] Plugin youvape-loyalty absent : repli sur l\'API WPLoyalty (sans motif ni n° de commande).');
    fallbackLogged = true;
  }
  const { data } = await axios.post(
    `${baseUrl}/wp-json/wc/v3/wployalty/customers/points/${action}`,
    { user_email: email, points },
    options
  );
  checkWployaltyResponse(data);
  return { success: true, points, requested: points, via: 'wployalty', data };
};

const addPoints = (email, points, reason) => call('add', email, points, reason);
const reducePoints = (email, points, reason) => call('reduce', email, points, reason);

module.exports = { addPoints, reducePoints, connection, isNoRoute, checkWployaltyResponse, PLUGIN_NAMESPACE };
