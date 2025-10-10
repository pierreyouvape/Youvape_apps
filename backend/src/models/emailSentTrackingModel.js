const pool = require('../config/database');

const emailSentTrackingModel = {
  // Créer une entrée dans le tracking
  create: async (trackingData) => {
    const { order_id, customer_email, reviews_count } = trackingData;

    const query = `
      INSERT INTO email_sent_tracking (order_id, customer_email, reviews_count)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const values = [
      order_id,
      customer_email,
      reviews_count || 1
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Vérifier si un email a déjà été envoyé pour une commande
  exists: async (order_id) => {
    const query = 'SELECT * FROM email_sent_tracking WHERE order_id = $1';
    const result = await pool.query(query, [order_id]);
    return result.rows.length > 0;
  },

  // Récupérer tout l'historique des emails envoyés
  getAll: async () => {
    const query = `
      SELECT * FROM email_sent_tracking
      ORDER BY sent_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Récupérer l'historique filtré par date
  getByDate: async (date) => {
    const query = `
      SELECT * FROM email_sent_tracking
      WHERE DATE(sent_at) = $1
      ORDER BY sent_at DESC
    `;

    const result = await pool.query(query, [date]);
    return result.rows;
  },

  // Récupérer les statistiques
  getStats: async () => {
    const query = `
      SELECT
        COUNT(*) as total_emails_sent,
        COUNT(DISTINCT order_id) as unique_orders,
        SUM(reviews_count) as total_reviews_notified
      FROM email_sent_tracking
    `;

    const result = await pool.query(query);
    return result.rows[0];
  },

  // Récupérer un tracking par order_id
  getByOrderId: async (order_id) => {
    const query = 'SELECT * FROM email_sent_tracking WHERE order_id = $1';
    const result = await pool.query(query, [order_id]);
    return result.rows[0];
  }
};

module.exports = emailSentTrackingModel;
