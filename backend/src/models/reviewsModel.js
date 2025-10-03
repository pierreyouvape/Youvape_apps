const pool = require('../config/database');

const reviewsModel = {
  // Insérer ou mettre à jour un avis
  create: async (reviewData) => {
    const { review_id, review_type, rating, comment, customer_name, customer_email, product_id, review_date, review_status } = reviewData;

    const query = `
      INSERT INTO reviews (review_id, review_type, rating, comment, customer_name, customer_email, product_id, review_date, review_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (review_id)
      DO UPDATE SET
        review_status = EXCLUDED.review_status,
        rating = EXCLUDED.rating,
        comment = EXCLUDED.comment,
        customer_name = EXCLUDED.customer_name,
        customer_email = EXCLUDED.customer_email,
        product_id = EXCLUDED.product_id,
        review_date = EXCLUDED.review_date,
        updated_at = CURRENT_TIMESTAMP
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
      review_date || null,
      review_status || 0
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  },

  // Récupérer tous les avis triés par date de l'avis (les plus récents en haut)
  getAll: async () => {
    const query = `
      SELECT * FROM reviews
      ORDER BY review_date DESC NULLS LAST, created_at DESC
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
  },

  // Vider tous les avis
  deleteAll: async () => {
    const query = 'TRUNCATE TABLE reviews CASCADE';
    await pool.query(query);
    return { success: true };
  }
};

module.exports = reviewsModel;
