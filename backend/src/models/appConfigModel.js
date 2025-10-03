const pool = require('../config/database');

const appConfigModel = {
  // Sauvegarder ou mettre à jour une configuration
  upsert: async (key, value) => {
    const query = `
      INSERT INTO app_config (config_key, config_value, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (config_key)
      DO UPDATE SET config_value = $2, updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [key, value];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer une configuration par clé
  get: async (key) => {
    const query = 'SELECT * FROM app_config WHERE config_key = $1';
    const result = await pool.query(query, [key]);
    return result.rows[0];
  },

  // Récupérer toutes les configurations
  getAll: async () => {
    const query = 'SELECT * FROM app_config';
    const result = await pool.query(query);
    return result.rows;
  },

  // Supprimer une configuration
  delete: async (key) => {
    const query = 'DELETE FROM app_config WHERE config_key = $1 RETURNING *';
    const result = await pool.query(query, [key]);
    return result.rows[0];
  }
};

module.exports = appConfigModel;
