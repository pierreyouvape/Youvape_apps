const pool = require('../config/database');

class CustomerNoteModel {
  /**
   * Récupère toutes les notes d'un client
   */
  async getByCustomerId(customerId) {
    const query = `
      SELECT * FROM customer_notes
      WHERE customer_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [customerId]);
    return result.rows;
  }

  /**
   * Crée une nouvelle note
   */
  async create(customerId, note, createdBy = 'system') {
    const query = `
      INSERT INTO customer_notes (customer_id, note, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      RETURNING *
    `;
    const result = await pool.query(query, [customerId, note, createdBy]);
    return result.rows[0];
  }

  /**
   * Met à jour une note existante
   */
  async update(noteId, note) {
    const query = `
      UPDATE customer_notes
      SET note = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;
    const result = await pool.query(query, [note, noteId]);
    return result.rows[0];
  }

  /**
   * Supprime une note
   */
  async delete(noteId) {
    const query = `DELETE FROM customer_notes WHERE id = $1 RETURNING *`;
    const result = await pool.query(query, [noteId]);
    return result.rows[0];
  }
}

module.exports = new CustomerNoteModel();
