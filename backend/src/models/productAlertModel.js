const pool = require('../config/database');

const productAlertModel = {
  // Récupérer l'alerte d'un produit
  getByProductId: async (productId) => {
    const query = 'SELECT * FROM product_alerts WHERE product_id = $1';
    const result = await pool.query(query, [productId]);
    return result.rows[0];
  },

  // Récupérer toutes les alertes
  getAll: async () => {
    const query = `
      SELECT
        pa.*,
        p.post_title as product_name,
        p.sku as product_sku,
        p.stock
      FROM product_alerts pa
      JOIN products p ON pa.product_id = p.id
      ORDER BY p.post_title
    `;
    const result = await pool.query(query);
    return result.rows;
  },

  // Créer ou mettre à jour une alerte
  upsert: async (productId, alertThreshold, notes = null) => {
    const query = `
      INSERT INTO product_alerts (product_id, alert_threshold, notes)
      VALUES ($1, $2, $3)
      ON CONFLICT (product_id) DO UPDATE SET
        alert_threshold = EXCLUDED.alert_threshold,
        notes = EXCLUDED.notes,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    const result = await pool.query(query, [productId, alertThreshold, notes]);
    return result.rows[0];
  },

  // Supprimer une alerte
  delete: async (productId) => {
    const query = 'DELETE FROM product_alerts WHERE product_id = $1 RETURNING *';
    const result = await pool.query(query, [productId]);
    return result.rows[0];
  },

  // Récupérer les alertes pour plusieurs produits (bulk)
  getByProductIds: async (productIds) => {
    if (!productIds || productIds.length === 0) return {};

    const query = `
      SELECT product_id, alert_threshold, notes
      FROM product_alerts
      WHERE product_id = ANY($1)
    `;
    const result = await pool.query(query, [productIds]);

    // Retourner un objet indexé par product_id
    const alertsMap = {};
    result.rows.forEach(row => {
      alertsMap[row.product_id] = {
        alert_threshold: row.alert_threshold,
        notes: row.notes
      };
    });
    return alertsMap;
  },

  // Import bulk des alertes
  bulkUpsert: async (alerts) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const alert of alerts) {
        await client.query(`
          INSERT INTO product_alerts (product_id, alert_threshold, notes)
          VALUES ($1, $2, $3)
          ON CONFLICT (product_id) DO UPDATE SET
            alert_threshold = EXCLUDED.alert_threshold,
            notes = EXCLUDED.notes,
            updated_at = CURRENT_TIMESTAMP
        `, [alert.product_id, alert.alert_threshold, alert.notes || null]);
      }

      await client.query('COMMIT');
      return { success: true, count: alerts.length };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = productAlertModel;
