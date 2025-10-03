const pool = require('../config/database');

const reviewsLog = {
  // Créer un nouveau log
  create: async (logData) => {
    const { api_key_used, review_type, limit_value, product_id, page, response_status, response_data, error_message } = logData;

    const query = `
      INSERT INTO reviews_logs (api_key_used, review_type, limit_value, product_id, page, response_status, response_data, error_message)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [api_key_used, review_type, limit_value, product_id || null, page || 1, response_status, response_data, error_message || null];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer tous les logs des 30 derniers jours
  getAll: async (dateFilter = null) => {
    let query = `
      SELECT * FROM reviews_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `;

    const values = [];

    if (dateFilter) {
      query += ` AND DATE(created_at) = $1`;
      values.push(dateFilter);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);
    return result.rows;
  },

  // Récupérer les logs pour export CSV
  getAllForExport: async (dateFilter = null) => {
    let query = `
      SELECT
        id,
        api_key_used,
        review_type,
        limit_value,
        product_id,
        page,
        response_status,
        error_message,
        created_at
      FROM reviews_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `;

    const values = [];

    if (dateFilter) {
      query += ` AND DATE(created_at) = $1`;
      values.push(dateFilter);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await pool.query(query, values);
    return result.rows;
  }
};

module.exports = reviewsLog;
