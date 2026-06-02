const pool = require('../config/database');

class SavAutomationModel {

  async getAll() {
    const res = await pool.query(
      `SELECT * FROM sav_automations ORDER BY created_at DESC`
    );
    return res.rows;
  }

  async getAllEnabled() {
    const res = await pool.query(
      `SELECT * FROM sav_automations WHERE enabled = TRUE`
    );
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(`SELECT * FROM sav_automations WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async create({ name, description, filter_status, conditions, target_status, enabled }) {
    const res = await pool.query(
      `INSERT INTO sav_automations
       (name, description, filter_status, conditions, target_status, enabled)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        name,
        description || null,
        filter_status || null,
        JSON.stringify(conditions || []),
        target_status,
        enabled !== false,
      ]
    );
    return res.rows[0];
  }

  async update(id, fields) {
    const ALLOWED = ['name', 'description', 'filter_status', 'conditions', 'target_status', 'enabled'];
    const sets = [];
    const values = [];
    let idx = 1;
    for (const [k, v] of Object.entries(fields)) {
      if (!ALLOWED.includes(k)) continue;
      if (k === 'conditions') {
        sets.push(`conditions = $${idx++}::jsonb`);
        values.push(JSON.stringify(v));
      } else {
        sets.push(`${k} = $${idx++}`);
        values.push(v);
      }
    }
    if (sets.length === 0) return null;
    sets.push(`updated_at = NOW()`);
    values.push(id);
    const res = await pool.query(
      `UPDATE sav_automations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  async delete(id) {
    const res = await pool.query(`DELETE FROM sav_automations WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }

  // Marque l'exécution d'un automatisme (pour debug UI)
  async markRun(id, count) {
    await pool.query(
      `UPDATE sav_automations SET last_run_at = NOW(), last_run_count = $1 WHERE id = $2`,
      [count, id]
    );
  }
}

module.exports = new SavAutomationModel();
