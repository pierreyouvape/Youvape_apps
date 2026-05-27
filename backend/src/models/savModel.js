const pool = require('../config/database');

const VALID_STATUSES = ['ouvert', 'accepté', 'terminé', 'refusé'];

class SavModel {

  // ─── Créer un ticket depuis webhook Gravity Forms ────────────────────────
  async create({ order_id, customer_id, customer_name, customer_email, customer_phone, subject, description, source = 'gravity_form' }) {
    const result = await pool.query(
      `INSERT INTO sav_tickets
         (order_id, customer_id, customer_name, customer_email, customer_phone, subject, description, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [order_id || null, customer_id || null, customer_name, customer_email, customer_phone || null, subject, description, source]
    );
    return result.rows[0];
  }

  // ─── Liste avec filtres, recherche et pagination ──────────────────────────
  async getAll({ limit = 50, offset = 0, sav_status, search } = {}) {
    const conditions = [];
    const values = [];
    let idx = 1;

    if (sav_status) {
      conditions.push(`t.sav_status = $${idx++}`);
      values.push(sav_status);
    }

    if (search) {
      conditions.push(`(
        t.customer_name ILIKE $${idx} OR
        t.customer_email ILIKE $${idx} OR
        t.order_id ILIKE $${idx} OR
        t.subject ILIKE $${idx}
      )`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM sav_tickets t ${where}`,
      values
    );
    const total = parseInt(countResult.rows[0].count);

    // Données paginées
    values.push(limit, offset);
    const result = await pool.query(
      `SELECT
         t.*,
         o.post_status as order_status,
         o.order_total as order_total
       FROM sav_tickets t
       LEFT JOIN orders o ON o.wp_order_id = t.order_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    return { tickets: result.rows, total };
  }

  // ─── Détail d'un ticket ───────────────────────────────────────────────────
  async getById(id) {
    const result = await pool.query(
      `SELECT
         t.*,
         o.post_status       as order_status,
         o.order_total       as order_total,
         o.post_date         as order_date,
         o.billing_address_1 as order_address,
         o.billing_city      as order_city,
         o.billing_postcode  as order_postcode,
         c.total_spent       as customer_total_spent,
         c.orders_count      as customer_orders_count
       FROM sav_tickets t
       LEFT JOIN orders    o ON o.wp_order_id = t.order_id
       LEFT JOIN customers c ON c.id = t.customer_id
       WHERE t.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  // ─── Tickets par commande ─────────────────────────────────────────────────
  async getByOrderId(order_id) {
    const result = await pool.query(
      `SELECT * FROM sav_tickets WHERE order_id = $1 ORDER BY created_at DESC`,
      [order_id]
    );
    return result.rows;
  }

  // ─── Tickets par client ───────────────────────────────────────────────────
  async getByCustomerId(customer_id) {
    const result = await pool.query(
      `SELECT id, subject, sav_status, created_at, updated_at
       FROM sav_tickets WHERE customer_id = $1 ORDER BY created_at DESC`,
      [customer_id]
    );
    return result.rows;
  }

  // ─── Mettre à jour le statut ──────────────────────────────────────────────
  async updateStatus(id, sav_status) {
    if (!VALID_STATUSES.includes(sav_status)) {
      throw new Error(`Statut invalide. Valeurs acceptées : ${VALID_STATUSES.join(', ')}`);
    }
    const result = await pool.query(
      `UPDATE sav_tickets SET sav_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [sav_status, id]
    );
    return result.rows[0] || null;
  }

  // ─── Ajouter un message dans le JSONB messages ───────────────────────────
  async addMessage(id, { from, body, is_agent }) {
    const message = {
      from,
      body,
      is_agent: !!is_agent,
      date: new Date().toISOString(),
    };
    const result = await pool.query(
      `UPDATE sav_tickets
       SET messages = messages || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify([message]), id]
    );
    return result.rows[0] || null;
  }

  // ─── Mettre à jour les notes internes ────────────────────────────────────
  async updateNotes(id, notes) {
    const result = await pool.query(
      `UPDATE sav_tickets SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [notes, id]
    );
    return result.rows[0] || null;
  }

  // ─── Trouver un ticket par ID pour matching email entrant ─────────────────
  async findById(id) {
    const result = await pool.query(
      `SELECT * FROM sav_tickets WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }
}

module.exports = new SavModel();
