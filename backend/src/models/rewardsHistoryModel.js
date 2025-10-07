const pool = require('../config/database');

const rewardsHistoryModel = {
  // Créer une entrée dans l'historique
  create: async (historyData) => {
    const { review_id, customer_email, points_awarded, review_type, api_response, api_status, error_message, rewarded } = historyData;

    const query = `
      INSERT INTO rewards_history (review_id, customer_email, points_awarded, review_type, api_response, api_status, error_message, rewarded)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      review_id,
      customer_email,
      points_awarded,
      review_type,
      api_response ? JSON.stringify(api_response) : null,
      api_status || null,
      error_message || null,
      rewarded || false
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Vérifier si un avis a déjà été récompensé avec succès
  exists: async (review_id) => {
    const query = 'SELECT * FROM rewards_history WHERE review_id = $1 AND rewarded = true';
    const result = await pool.query(query, [review_id]);
    return result.rows.length > 0;
  },

  // Récupérer tout l'historique
  getAll: async () => {
    const query = `
      SELECT * FROM rewards_history
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Récupérer l'historique filtré par date
  getByDate: async (date) => {
    const query = `
      SELECT * FROM rewards_history
      WHERE DATE(created_at) = $1
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query, [date]);
    return result.rows;
  },

  // Récupérer les statistiques
  getStats: async () => {
    const query = `
      SELECT
        COUNT(*) as total_rewards,
        SUM(points_awarded) as total_points,
        COUNT(CASE WHEN api_status >= 200 AND api_status < 300 THEN 1 END) as successful_rewards,
        COUNT(CASE WHEN api_status IS NULL OR api_status >= 400 THEN 1 END) as failed_rewards
      FROM rewards_history
    `;

    const result = await pool.query(query);
    return result.rows[0];
  }
};

module.exports = rewardsHistoryModel;
