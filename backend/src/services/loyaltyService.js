/**
 * Points fidélité WPLoyalty — même appel que les récompenses d'avis
 * (rewardService.rewardCustomer), sans l'historique propre aux avis.
 * Sert aux Retours : un avoir client est crédité en points (100 pts = 1 €).
 */

const axios = require('axios');
const pool = require('../config/database');

const addPoints = async (email, points) => {
  const { rows: [cfg] } = await pool.query(
    'SELECT woocommerce_url, consumer_key, consumer_secret FROM rewards_config LIMIT 1'
  );
  if (!cfg?.woocommerce_url || !cfg.consumer_key) throw new Error('Identifiants WooCommerce non configurés (Récompense Avis).');
  const { data } = await axios.post(
    `${cfg.woocommerce_url.replace(/\/$/, '')}/wp-json/wc/v3/wployalty/customers/points/add`,
    { user_email: email, points },
    {
      params: { consumer_key: cfg.consumer_key, consumer_secret: cfg.consumer_secret },
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }
  );
  return data;
};

module.exports = { addPoints };
