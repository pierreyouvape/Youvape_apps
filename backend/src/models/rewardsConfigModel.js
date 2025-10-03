const pool = require('../config/database');

const rewardsConfigModel = {
  // Créer ou mettre à jour la configuration
  upsert: async (configData) => {
    const { woocommerce_url, consumer_key, consumer_secret, points_site, points_product, enabled } = configData;

    // Vérifier s'il y a déjà une config
    const existing = await pool.query('SELECT * FROM rewards_config LIMIT 1');

    if (existing.rows.length > 0) {
      // UPDATE
      const query = `
        UPDATE rewards_config
        SET woocommerce_url = $1,
            consumer_key = $2,
            consumer_secret = $3,
            points_site = $4,
            points_product = $5,
            enabled = $6,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
      `;

      const values = [
        woocommerce_url,
        consumer_key,
        consumer_secret,
        points_site,
        points_product,
        enabled !== undefined ? enabled : true,
        existing.rows[0].id
      ];

      const result = await pool.query(query, values);
      return result.rows[0];
    } else {
      // INSERT
      const query = `
        INSERT INTO rewards_config (woocommerce_url, consumer_key, consumer_secret, points_site, points_product, enabled)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const values = [
        woocommerce_url,
        consumer_key,
        consumer_secret,
        points_site,
        points_product,
        enabled !== undefined ? enabled : true
      ];

      const result = await pool.query(query, values);
      return result.rows[0];
    }
  },

  // Récupérer la configuration
  get: async () => {
    const query = 'SELECT * FROM rewards_config LIMIT 1';
    const result = await pool.query(query);
    return result.rows[0] || null;
  },

  // Activer/Désactiver le système de récompenses
  toggleEnabled: async (enabled) => {
    const query = `
      UPDATE rewards_config
      SET enabled = $1, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [enabled]);
    return result.rows[0];
  }
};

module.exports = rewardsConfigModel;
