const pool = require('../config/database');
const { emitChange } = require('../services/ticketEvents');

// ─── Statuts ──────────────────────────────────────────────────────────────────
async function getValidStatuses() {
  const res = await pool.query(`SELECT value FROM sav_ticket_statuses ORDER BY sort_order`);
  return res.rows.map(r => r.value);
}

class StatusModel {
  async getAll() {
    const res = await pool.query(`SELECT * FROM sav_ticket_statuses ORDER BY sort_order`);
    return res.rows;
  }

  async create({ value, label, bg_color, text_color }) {
    const res = await pool.query(
      `INSERT INTO sav_ticket_statuses (value, label, bg_color, text_color, sort_order, updated_at)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(sort_order),0)+1 FROM sav_ticket_statuses), NOW())
       RETURNING *`,
      [value, label, bg_color || '#F0F0F0', text_color || '#626E85']
    );
    return res.rows[0];
  }

  async update(id, { label, bg_color, text_color }) {
    const res = await pool.query(
      `UPDATE sav_ticket_statuses SET label=$1, bg_color=$2, text_color=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [label, bg_color, text_color, id]
    );
    return res.rows[0] || null;
  }

  async delete(id) {
    await pool.query(`DELETE FROM sav_ticket_statuses WHERE id=$1`, [id]);
  }
}

const statusModel = new StatusModel();

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
    const ticket = result.rows[0];
    if (ticket) emitChange(ticket.id, 'create');
    return ticket;
  }

  // ─── Liste avec filtres, recherche et pagination ──────────────────────────
  async getAll({ limit = 50, offset = 0, sav_status, sav_statuses, search } = {}) {
    const conditions = [];
    const values = [];
    let idx = 1;

    // sav_statuses = tableau (vues dynamiques), sav_status = string unique (compat)
    const statusArray = sav_statuses?.length ? sav_statuses
      : sav_status ? [sav_status] : [];

    if (statusArray.length > 0) {
      conditions.push(`t.sav_status = ANY($${idx++}::text[])`);
      values.push(statusArray);
    }

    if (search) {
      // Recherche large : identité (nom/prénom/email/tél), n° ticket, n° de
      // commande et de suivi (sur le ticket ET la commande liée), sujet,
      // description, et texte des messages échangés (JSONB → texte brut).
      conditions.push(`(
        t.id::text ILIKE $${idx} OR
        t.customer_name ILIKE $${idx} OR
        t.customer_first_name ILIKE $${idx} OR
        t.customer_last_name ILIKE $${idx} OR
        t.customer_email ILIKE $${idx} OR
        t.customer_phone ILIKE $${idx} OR
        t.order_id ILIKE $${idx} OR
        t.order_tracking ILIKE $${idx} OR
        t.subject ILIKE $${idx} OR
        t.description ILIKE $${idx} OR
        o.wp_order_id::text ILIKE $${idx} OR
        o.tracking_number ILIKE $${idx} OR
        t.messages::text ILIKE $${idx}
      )`);
      values.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Total count — JOIN orders nécessaire pour la recherche sur les champs commande
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM sav_tickets t
       LEFT JOIN orders o ON o.wp_order_id::text = t.order_id
       ${where}`,
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
       LEFT JOIN orders o ON o.wp_order_id::text = t.order_id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values
    );

    return { tickets: result.rows, total };
  }

  // ─── Détail d'un ticket avec infos client + commande ─────────────────────
  async getById(id) {
    // Ticket + commande concernée + client
    const result = await pool.query(
      `SELECT
         t.*,
         o.wp_order_id       as order_wp_id,
         o.post_status       as order_status,
         o.order_total       as order_total,
         o.post_date         as order_date,
         o.tracking_number   as order_tracking_from_order,
         o.shipping_carrier  as order_carrier,
         o.shipping_method   as order_shipping_method,
         c.first_name        as customer_first_name,
         c.last_name         as customer_last_name,
         c.email             as customer_email_db,
         c.user_registered   as customer_since,
         c.wp_user_id        as customer_wp_id,
         u.name              as assigned_to_name,
         u.email             as assigned_to_email
       FROM sav_tickets t
       LEFT JOIN orders    o ON o.wp_order_id::text = t.order_id
       LEFT JOIN customers c ON c.id = t.customer_id
       LEFT JOIN users     u ON u.id = t.assigned_to_id
       WHERE t.id = $1`,
      [id]
    );
    const ticket = result.rows[0] || null;
    if (!ticket) return null;

    // Articles de la commande concernée
    if (ticket.order_wp_id) {
      const itemsRes = await pool.query(
        `SELECT
           oi.order_item_name, oi.qty, oi.line_total,
           p.sku, p.image_url
         FROM order_items oi
         LEFT JOIN products p ON p.wp_product_id = COALESCE(oi.variation_id, oi.product_id)
         WHERE oi.wp_order_id = $1
           AND oi.order_item_type = 'line_item'
         ORDER BY oi.id`,
        [ticket.order_wp_id]
      );
      ticket.order_items = itemsRes.rows;
    } else {
      ticket.order_items = [];
    }

    // Stats client (nb commandes + CA)
    if (ticket.customer_wp_id) {
      const statsRes = await pool.query(
        `SELECT COUNT(*) as orders_count, SUM(order_total) as total_spent
         FROM orders WHERE wp_customer_id = $1 AND post_status NOT IN ('wc-cancelled','wc-failed','trash')`,
        [ticket.customer_wp_id]
      );
      ticket.customer_orders_count = parseInt(statsRes.rows[0].orders_count) || 0;
      ticket.customer_total_spent  = parseFloat(statsRes.rows[0].total_spent) || 0;

      // Historique commandes (hors commande concernée) avec articles
      const histRes = await pool.query(
        `SELECT wp_order_id, post_date, post_status, order_total, tracking_number, shipping_carrier
         FROM orders
         WHERE wp_customer_id = $1
           AND wp_order_id::text != $2
         ORDER BY post_date DESC`,
        [ticket.customer_wp_id, ticket.order_id || '0']
      );

      // Charger les articles pour chaque commande de l'historique
      const histOrders = histRes.rows;
      for (const order of histOrders) {
        const itemsRes = await pool.query(
          `SELECT
             oi.order_item_name, oi.qty, oi.line_total,
             p.sku, p.image_url
           FROM order_items oi
           LEFT JOIN products p ON p.wp_product_id = COALESCE(oi.variation_id, oi.product_id)
           WHERE oi.wp_order_id = $1
             AND oi.order_item_type = 'line_item'
           ORDER BY oi.id`,
          [order.wp_order_id]
        );
        order.items = itemsRes.rows;
      }
      ticket.customer_orders_history = histOrders;
    } else {
      ticket.customer_orders_count   = 0;
      ticket.customer_total_spent    = 0;
      ticket.customer_orders_history = [];
    }

    // Autres tickets du même client (par customer_id sinon par email),
    // hors ticket courant. Sert au volet « Tickets du client ».
    const matchEmail = (ticket.customer_email_db || ticket.customer_email || '').trim();
    if (ticket.customer_id || matchEmail) {
      const cond = [];
      const vals = [ticket.id];
      let i = 2;
      if (ticket.customer_id) { cond.push(`t.customer_id = $${i++}`); vals.push(ticket.customer_id); }
      if (matchEmail)         { cond.push(`LOWER(t.customer_email) = LOWER($${i++})`); vals.push(matchEmail); }
      const ticketsRes = await pool.query(
        `SELECT
           t.id, t.subject, t.sav_status, t.order_id,
           t.created_at, t.updated_at,
           jsonb_array_length(COALESCE(t.messages, '[]'::jsonb)) AS message_count
         FROM sav_tickets t
         WHERE t.id != $1 AND (${cond.join(' OR ')})
         ORDER BY t.created_at DESC
         LIMIT 50`,
        vals
      );
      ticket.customer_tickets = ticketsRes.rows;
    } else {
      ticket.customer_tickets = [];
    }

    return ticket;
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
  // last_status_change_at est remis à NOW() à chaque appel, même si le statut
  // ne change pas, pour permettre à l'agent de "réinitialiser" le compteur
  // des automatismes (ex. relancer un délai d'attente).
  async updateStatus(id, sav_status) {
    const valid = await getValidStatuses();
    if (!valid.includes(sav_status)) {
      throw new Error(`Statut invalide. Valeurs acceptées : ${valid.join(', ')}`);
    }
    const result = await pool.query(
      `UPDATE sav_tickets
       SET sav_status = $1,
           last_status_change_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 RETURNING *`,
      [sav_status, id]
    );
    const ticket = result.rows[0] || null;
    if (ticket) emitChange(ticket.id, 'status');
    return ticket;
  }

  // ─── Ajouter un message dans le JSONB messages ───────────────────────────
  async addMessage(id, { from, body, is_agent, is_private, attachments, send_failed, error }) {
    const message = {
      from,
      body,
      is_agent: !!is_agent,
      is_private: !!is_private,
      date: new Date().toISOString(),
      attachments: Array.isArray(attachments) ? attachments : [],
    };
    // Flag d'échec d'envoi (badge "⚠ Non envoyé" côté front)
    if (send_failed) {
      message.send_failed = true;
      if (error) message.error = String(error);
    }
    const result = await pool.query(
      `UPDATE sav_tickets
       SET messages = messages || $1::jsonb,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING *`,
      [JSON.stringify([message]), id]
    );
    const ticket = result.rows[0] || null;
    if (ticket) emitChange(ticket.id, 'message');
    return ticket;
  }

  // ─── Mettre à jour les notes internes ────────────────────────────────────
  async updateNotes(id, notes) {
    const result = await pool.query(
      `UPDATE sav_tickets SET notes = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [notes, id]
    );
    const ticket = result.rows[0] || null;
    if (ticket) emitChange(ticket.id, 'notes');
    return ticket;
  }

  // ─── Mettre à jour des champs libres (PATCH) ─────────────────────────────
  async patch(id, fields) {
    // Champs autorisés à être mis à jour par PATCH
    const ALLOWED = [
      'customer_name', 'customer_email', 'customer_phone', 'order_id',
      'subject', 'assigned_to', 'assigned_to_id', 'ticket_type', 'priority', 'subject_category',
      'tags', 'order_tracking',
    ];
    const setClauses = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of Object.entries(fields)) {
      if (!ALLOWED.includes(key)) continue;
      setClauses.push(`${key} = $${idx++}`);
      values.push(value);
    }
    if (setClauses.length === 0) return null;
    setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);
    const result = await pool.query(
      `UPDATE sav_tickets SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    const ticket = result.rows[0] || null;
    if (ticket) emitChange(ticket.id, 'patch');
    return ticket;
  }

  // ─── Trouver un ticket par ID pour matching email entrant ─────────────────
  async findById(id) {
    const result = await pool.query(
      `SELECT * FROM sav_tickets WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  // ─── Suivre la chaîne de fusion jusqu'au ticket actif ────────────────────
  // Si le ticket trouvé a été fusionné (merged_into_id), on remonte vers la
  // cible, en boucle, jusqu'à tomber sur un ticket non fusionné. Garde-fou
  // anti-boucle (max 10 sauts) au cas où une chaîne incohérente existerait.
  // Résout un ticket à partir d'un ID Zendesk (webhook inbound). On matche
  // EXCLUSIVEMENT sur la colonne zendesk_id : un ticket créé dans l'app (sans
  // zendesk_id) ne doit jamais être ciblé par une réponse Zendesk, même si son
  // id app coïncide par hasard avec un numéro Zendesk. Puis on suit la chaîne
  // de fusion comme resolveActiveTicket.
  async resolveActiveByZendeskId(zendeskId) {
    const r = await pool.query(
      'SELECT id FROM sav_tickets WHERE zendesk_id = $1 ORDER BY id LIMIT 1',
      [zendeskId]
    );
    if (r.rows.length === 0) return null;
    return this.resolveActiveTicket(r.rows[0].id);
  }

  async resolveActiveTicket(id) {
    let ticket = await this.findById(id);
    const seen = new Set();
    let hops = 0;
    while (ticket && ticket.merged_into_id && !seen.has(ticket.id) && hops < 10) {
      seen.add(ticket.id);
      hops += 1;
      const next = await this.findById(ticket.merged_into_id);
      if (!next) break; // cible supprimée (ON DELETE SET NULL) → on garde le ticket courant
      ticket = next;
    }
    return ticket;
  }
}

const savModel = new SavModel();
savModel.statusModel = statusModel;
module.exports = savModel;
