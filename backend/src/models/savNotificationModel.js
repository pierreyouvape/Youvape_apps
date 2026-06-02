const pool = require('../config/database');

class SavNotificationModel {

  // Liste des notifications d'un utilisateur
  async getAllForUser(userId) {
    const res = await pool.query(
      `SELECT * FROM sav_notifications WHERE created_by = $1 ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(`SELECT * FROM sav_notifications WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  // Toutes les notifications actives matchant un déclencheur — utilisé par le
  // dispatcher au moment d'un événement (peu importe l'utilisateur créateur).
  async getActiveByTrigger(trigger) {
    const res = await pool.query(
      `SELECT * FROM sav_notifications WHERE trigger = $1 AND enabled = TRUE`,
      [trigger]
    );
    return res.rows;
  }

  async create({ trigger, action, recipients, enabled, created_by }) {
    const res = await pool.query(
      `INSERT INTO sav_notifications (trigger, action, recipients, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [trigger, action, recipients, enabled !== false, created_by]
    );
    return res.rows[0];
  }

  // PATCH partiel : on ne met à jour que les champs fournis.
  async update(id, fields) {
    const ALLOWED = ['trigger', 'action', 'recipients', 'enabled'];
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (!ALLOWED.includes(k)) continue;
      sets.push(`${k} = $${idx++}`);
      values.push(v);
    }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE sav_notifications SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  async delete(id) {
    const res = await pool.query(`DELETE FROM sav_notifications WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }
}

module.exports = new SavNotificationModel();
