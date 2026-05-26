const pool = require('../config/database');

class SavModel {
  async create({ order_id, customer_id, zendesk_ticket_id, zendesk_ticket_status, notes }) {
    const result = await pool.query(
      `INSERT INTO sav_tickets (order_id, customer_id, zendesk_ticket_id, zendesk_ticket_status, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [order_id, customer_id || null, zendesk_ticket_id, zendesk_ticket_status || null, notes || null]
    );
    return result.rows[0];
  }

  async getByOrderId(order_id) {
    const result = await pool.query(
      `SELECT s.*, c.first_name, c.last_name, c.email
       FROM sav_tickets s
       LEFT JOIN customers c ON s.customer_id = c.id
       WHERE s.order_id = $1
       ORDER BY s.created_at DESC`,
      [order_id]
    );
    return result.rows;
  }

  async getByCustomerId(customer_id) {
    const result = await pool.query(
      `SELECT s.*
       FROM sav_tickets s
       WHERE s.customer_id = $1
       ORDER BY s.created_at DESC`,
      [customer_id]
    );
    return result.rows;
  }

  async getByZendeskId(zendesk_ticket_id) {
    const result = await pool.query(
      `SELECT s.*, c.first_name, c.last_name, c.email
       FROM sav_tickets s
       LEFT JOIN customers c ON s.customer_id = c.id
       WHERE s.zendesk_ticket_id = $1`,
      [zendesk_ticket_id]
    );
    return result.rows[0];
  }

  async updateStatus({ id, sav_status, zendesk_ticket_status }) {
    const fields = [];
    const values = [];
    let idx = 1;

    if (sav_status !== undefined) {
      fields.push(`sav_status = $${idx++}`);
      values.push(sav_status);
    }
    if (zendesk_ticket_status !== undefined) {
      fields.push(`zendesk_ticket_status = $${idx++}`);
      values.push(zendesk_ticket_status);
    }
    fields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE sav_tickets SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  async getAll({ limit = 50, offset = 0, sav_status } = {}) {
    const conditions = [];
    const values = [];
    let idx = 1;

    if (sav_status) {
      conditions.push(`s.sav_status = $${idx++}`);
      values.push(sav_status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    values.push(limit, offset);

    const result = await pool.query(
      `SELECT s.*, c.first_name, c.last_name, c.email
       FROM sav_tickets s
       LEFT JOIN customers c ON s.customer_id = c.id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );
    return result.rows;
  }

  async countByCustomerId(customer_id) {
    const result = await pool.query(
      `SELECT COUNT(*) as total FROM sav_tickets WHERE customer_id = $1`,
      [customer_id]
    );
    return parseInt(result.rows[0].total);
  }
}

module.exports = new SavModel();
