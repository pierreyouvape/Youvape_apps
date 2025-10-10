const pool = require('../config/database');

const emailConfigModel = {
  // Créer ou mettre à jour la configuration
  upsert: async (configData) => {
    const { probance_url, probance_token, campaign_external_id, enabled } = configData;

    const query = `
      INSERT INTO email_config (id, probance_url, probance_token, campaign_external_id, enabled, updated_at)
      VALUES (1, $1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (id)
      DO UPDATE SET
        probance_url = EXCLUDED.probance_url,
        probance_token = EXCLUDED.probance_token,
        campaign_external_id = EXCLUDED.campaign_external_id,
        enabled = EXCLUDED.enabled,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      probance_url,
      probance_token,
      campaign_external_id,
      enabled !== undefined ? enabled : true
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer la configuration
  get: async () => {
    const query = 'SELECT * FROM email_config WHERE id = 1';
    const result = await pool.query(query);
    return result.rows[0] || null;
  },

  // Activer/désactiver le système
  toggleEnabled: async (enabled) => {
    const query = `
      UPDATE email_config
      SET enabled = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
      RETURNING *
    `;

    const result = await pool.query(query, [enabled]);
    return result.rows[0];
  }
};

module.exports = emailConfigModel;
