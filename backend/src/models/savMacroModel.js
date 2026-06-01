const pool = require('../config/database');

class SavMacroModel {

  async getAll() {
    const res = await pool.query(`
      SELECT m.*, u.name as created_by_name
      FROM sav_macros m
      LEFT JOIN users u ON u.id = m.created_by
      ORDER BY m.name ASC
    `);
    return res.rows;
  }

  async getById(id) {
    const res = await pool.query(`SELECT * FROM sav_macros WHERE id = $1`, [id]);
    return res.rows[0] || null;
  }

  async create({ name, description, subject, body, sav_status, attachment, created_by }) {
    const res = await pool.query(
      `INSERT INTO sav_macros
       (name, description, subject, body, sav_status,
        attachment_filename, attachment_original_name, attachment_size, attachment_mime,
        created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        name,
        description || null,
        subject || null,
        body || null,
        sav_status || null,
        attachment?.filename || null,
        attachment?.original_name || null,
        attachment?.size || null,
        attachment?.mime || null,
        created_by || null,
      ]
    );
    return res.rows[0];
  }

  // Mise à jour. attachment = undefined -> ne touche pas, null -> efface, objet -> remplace
  async update(id, { name, description, subject, body, sav_status, attachment }) {
    const sets = [
      'name = $1', 'description = $2', 'subject = $3', 'body = $4', 'sav_status = $5',
      'updated_at = NOW()',
    ];
    const values = [
      name,
      description || null,
      subject || null,
      body || null,
      sav_status || null,
    ];
    let idx = 6;

    if (attachment === null) {
      // Efface la PJ
      sets.push(
        `attachment_filename = NULL`,
        `attachment_original_name = NULL`,
        `attachment_size = NULL`,
        `attachment_mime = NULL`,
      );
    } else if (attachment) {
      // Remplace
      sets.push(
        `attachment_filename = $${idx++}`,
        `attachment_original_name = $${idx++}`,
        `attachment_size = $${idx++}`,
        `attachment_mime = $${idx++}`,
      );
      values.push(attachment.filename, attachment.original_name, attachment.size, attachment.mime);
    }
    values.push(id);

    const res = await pool.query(
      `UPDATE sav_macros SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  async delete(id) {
    const res = await pool.query(`DELETE FROM sav_macros WHERE id = $1 RETURNING *`, [id]);
    return res.rows[0] || null;
  }
}

module.exports = new SavMacroModel();
