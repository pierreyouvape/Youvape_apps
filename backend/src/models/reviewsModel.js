const pool = require('../config/database');

const reviewsModel = {
  // Insérer un avis (ignoré si review_id existe déjà)
  create: async (reviewData) => {
    const { review_id, review_type, rating, comment, customer_name, customer_email, product_id, review_date } = reviewData;

    const query = `
      INSERT INTO reviews (review_id, review_type, rating, comment, customer_name, customer_email, product_id, review_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (review_id) DO NOTHING
      RETURNING *
    `;

    const values = [
      review_id,
      review_type,
      rating,
      comment || null,
      customer_name || null,
      customer_email || null,
      product_id || null,
      review_date || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer tous les avis triés par date décroissante
  getAll: async () => {
    const query = `
      SELECT * FROM reviews
      ORDER BY created_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Mettre à jour le statut récompensé
  updateRewardStatus: async (id, rewarded) => {
    const query = `
      UPDATE reviews
      SET rewarded = $1
      WHERE id = $2
      RETURNING *
    `;

    const values = [rewarded, id];
    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer un avis par ID
  getById: async (id) => {
    const query = 'SELECT * FROM reviews WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }
};

module.exports = reviewsModel;
