/**
 * Points fidélité WPLoyalty — même appel que les récompenses d'avis
 * (rewardService.rewardCustomer), sans l'historique propre aux avis.
 * Sert aux Retours : un avoir client est crédité en points (100 pts = 1 €).
 *
 * ⚠️ L'API documentée n'accepte que `user_email` et `points`
 * (docs.wployalty.net/developers, vérifié le 14/10/2026). Le motif
 * (« Avoir commande N°… ») part quand même en `comment` / `note` : ignoré s'il
 * n'est pas lu, affiché dans l'historique WPLoyalty s'il l'est.
 */

const axios = require('axios');
const pool = require('../config/database');

const call = async (action, email, points, comment) => {
  const { rows: [cfg] } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret FROM rewards_config LIMIT 1'
  );
  if (!cfg?.woocommerce_url || !cfg.consumer_key) throw new Error('Identifiants WooCommerce non configurés (Récompense Avis).');
  const { data } = await axios.post(
    `${cfg.woocommerce_url.replace(/\/$/, '')}/wp-json/wc/v3/wployalty/customers/points/${action}`,
    { user_email: email, points, ...(comment ? { comment, note: comment } : {}) },
    {
      params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );
  return data;
};

const addPoints = (email, points, comment = null) => call('add', email, points, comment);
const reducePoints = (email, points, comment = null) => call('reduce', email, points, comment);

module.exports = { addPoints, reducePoints };
