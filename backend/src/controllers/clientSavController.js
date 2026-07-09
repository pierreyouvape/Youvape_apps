const crypto = require('crypto');
const pool = require('../config/database');
const savModel = require('../models/savModel');
const appConfigModel = require('../models/appConfigModel');
const { saveAttachments } = require('../utils/savAttachments');
const { dispatchNotifications } = require('../services/notificationDispatcher');
const { getClientSavSecret, CLIENT_SAV_SECRET_KEY } = require('../utils/clientSavSecret');

// Statut appliqué à un ticket quand le client (ré)agit : remonte le ticket dans
// la file agent. Identique au comportement d'un email inbound client.
const CLIENT_REPLY_STATUS = 'reponse_client';

// Limites de validation des entrées client (création de ticket)
const MAX_SUBJECT_LEN = 150;
const MAX_BODY_LEN = 10000;
const MAX_PRODUCT_LABEL_LEN = 200;

/**
 * Convertit un texte brut saisi par le client en HTML sûr pour le stockage du
 * message (les messages agent sont en HTML ; on harmonise). Échappe les
 * caractères dangereux puis transforme les sauts de ligne en <br>.
 */
function plainTextToSafeHtml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return escaped.replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * Contrôleur de l'espace client SAV ("Mes demandes au service client").
 *
 * Surface appelée en server-to-server par le plugin WordPress. L'identité du
 * client (req.clientCustomerId / req.clientWpUserId) est posée par
 * clientSavMiddleware à partir du wp_user_id de la session WordPress — JAMAIS
 * d'un id venu du corps de la requête. Toutes les requêtes ci-dessous sont
 * scopées sur ces valeurs (anti-IDOR).
 *
 * Règle métier : l'espace n'expose que les tickets nés de l'espace client
 * (source = 'account'). Pas d'historique email/Gravity Forms/Zendesk.
 *
 * Garde-fou statut : on ne renvoie jamais le libellé interne (label) au client.
 * On renvoie client_label, avec un repli "En cours de traitement" si NULL.
 */

const DEFAULT_CLIENT_LABEL = 'En cours de traitement';
const CLIENT_TICKET_SOURCE = 'account';
const AGENT_DISPLAY_NAME = 'Service client YouVape';

/**
 * Projette un message brut (JSONB du ticket) vers la forme exposée au client.
 * Ne JAMAIS exposer : is_private, send_failed, error, ni le vrai nom de l'agent.
 *
 * @param {object} m message stocké
 * @param {string} customerName nom du client (pour libeller ses propres messages)
 * @returns {object} message public
 */
function toClientMessage(m, customerName) {
  const isAgent = !!m.is_agent;
  return {
    from: isAgent ? AGENT_DISPLAY_NAME : (customerName || 'Vous'),
    is_agent: isAgent,
    body: m.body || '',
    date: m.date || null,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
  };
}

const clientSavController = {

  // ─── Liste des tickets du client connecté ─────────────────────────────────
  getMyTickets: async (req, res) => {
    try {
      const customerId = req.clientCustomerId;

      const result = await pool.query(
        `SELECT
           t.id,
           t.subject,
           t.order_id,
           t.created_at,
           t.updated_at,
           COALESCE(NULLIF(s.client_label, ''), $2) AS status_label,
           jsonb_array_length(COALESCE(t.messages, '[]'::jsonb)) AS message_count
         FROM sav_tickets t
         LEFT JOIN sav_ticket_statuses s ON s.value = t.sav_status
         WHERE t.customer_id = $1
           AND t.source = $3
         ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC`,
        [customerId, DEFAULT_CLIENT_LABEL, CLIENT_TICKET_SOURCE]
      );

      res.json({ success: true, tickets: result.rows });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur getMyTickets:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Détail d'un ticket du client connecté (fil de discussion) ────────────
  // Scoping anti-IDOR : la requête filtre sur customer_id ET source='account'.
  // Un ticket qui n'appartient pas au client (ou hors espace) renvoie 404 —
  // jamais 403 détaillé, pour ne pas révéler l'existence du ticket.
  getMyTicket: async (req, res) => {
    try {
      const customerId = req.clientCustomerId;
      const ticketId = parseInt(req.params.id, 10);
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({ error: 'Identifiant invalide' });
      }

      const result = await pool.query(
        `SELECT
           t.id,
           t.subject,
           t.description,
           t.order_id,
           t.created_at,
           t.updated_at,
           t.customer_name,
           t.messages,
           COALESCE(NULLIF(s.client_label, ''), $3) AS status_label
         FROM sav_tickets t
         LEFT JOIN sav_ticket_statuses s ON s.value = t.sav_status
         WHERE t.id = $1
           AND t.customer_id = $2
           AND t.source = $4`,
        [ticketId, customerId, DEFAULT_CLIENT_LABEL, CLIENT_TICKET_SOURCE]
      );

      const row = result.rows[0];
      if (!row) {
        return res.status(404).json({ error: 'Demande introuvable' });
      }

      // Fil de discussion : on retire les notes internes (is_private) et on
      // normalise chaque message via toClientMessage (aucune fuite interne).
      const rawMessages = Array.isArray(row.messages) ? row.messages : [];
      const messages = rawMessages
        .filter((m) => !m.is_private)
        .map((m) => toClientMessage(m, row.customer_name));

      const ticket = {
        id: row.id,
        subject: row.subject,
        description: row.description,
        order_id: row.order_id,
        status_label: row.status_label,
        created_at: row.created_at,
        updated_at: row.updated_at,
        messages,
      };

      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur getMyTicket:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Réponse du client à un ticket existant ───────────────────────────────
  // Se comporte comme un email inbound client : ajoute le message (is_agent:false),
  // repasse le ticket en "reponse_client" pour le remonter dans la file agent, et
  // notifie les agents. Scoping anti-IDOR : on vérifie l'appartenance du ticket
  // AVANT toute écriture.
  replyToMyTicket: async (req, res) => {
    try {
      const customerId = req.clientCustomerId;
      const ticketId = parseInt(req.params.id, 10);
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(400).json({ error: 'Identifiant invalide' });
      }

      const body = (req.body.body || '').toString().trim();
      const hasFiles = Array.isArray(req.files) && req.files.length > 0;
      if (!body && !hasFiles) {
        return res.status(400).json({ error: 'Le message est requis' });
      }
      if (body.length > MAX_BODY_LEN) {
        return res.status(400).json({ error: 'Message trop long' });
      }

      // Vérifier l'appartenance AVANT d'écrire (et récupérer le contexte du ticket).
      const ticketRes = await pool.query(
        `SELECT id, customer_name, customer_email, subject, sav_status
         FROM sav_tickets
         WHERE id = $1 AND customer_id = $2 AND source = $3`,
        [ticketId, customerId, CLIENT_TICKET_SOURCE]
      );
      const ticket = ticketRes.rows[0];
      if (!ticket) {
        return res.status(404).json({ error: 'Demande introuvable' });
      }

      const storedAttachments = saveAttachments(ticketId, req.files);

      await savModel.addMessage(ticketId, {
        from: ticket.customer_name || 'Client',
        body: plainTextToSafeHtml(body),
        is_agent: false,
        is_private: false,
        attachments: storedAttachments,
      });

      // Remonter le ticket dans la file agent (si pas déjà au bon statut).
      if (ticket.sav_status !== CLIENT_REPLY_STATUS) {
        try {
          await savModel.updateStatus(ticketId, CLIENT_REPLY_STATUS);
        } catch (e) {
          console.warn(`[Client SAV] Maj statut ${CLIENT_REPLY_STATUS} échouée (#${ticketId}):`, e.message);
        }
      }

      // Notifier les agents (fire-and-forget, comme l'inbound email).
      dispatchNotifications('reply_received', ticket, {
        body, from: ticket.customer_name || ticket.customer_email,
      }).catch(() => {});

      res.json({ success: true });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur replyToMyTicket:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Création d'un ticket depuis l'espace client ──────────────────────────
  // Sécurité : customer_id / customer_email sont FORCÉS depuis l'identité résolue
  // par le middleware (req.clientCustomerId / req.clientEmail), jamais depuis le
  // corps de la requête. Une commande optionnelle est acceptée seulement si elle
  // appartient au client (sinon 403). Aucun email n'est envoyé au client à la
  // création (c'est lui qui ouvre la demande).
  createMyTicket: async (req, res) => {
    try {
      const customerId = req.clientCustomerId;
      const wpUserId   = req.clientWpUserId;

      const subject  = (req.body.subject || '').toString().trim();
      const body     = (req.body.body || '').toString().trim();
      const orderRaw = req.body.order_id;
      const product  = (req.body.product || '').toString().trim();

      // 1. Validation des champs
      if (!subject || !body) {
        return res.status(400).json({ error: 'Sujet et message sont requis' });
      }
      if (subject.length > MAX_SUBJECT_LEN) {
        return res.status(400).json({ error: 'Sujet trop long' });
      }
      if (body.length > MAX_BODY_LEN) {
        return res.status(400).json({ error: 'Message trop long' });
      }
      if (product.length > MAX_PRODUCT_LABEL_LEN) {
        return res.status(400).json({ error: 'Produit concerné invalide' });
      }

      // 2. Commande optionnelle — vérifier l'appartenance au client (anti-IDOR)
      let order_id = null;
      if (orderRaw !== undefined && orderRaw !== null && `${orderRaw}`.trim() !== '') {
        const wpOrderId = parseInt(orderRaw, 10);
        if (!Number.isInteger(wpOrderId) || wpOrderId <= 0) {
          return res.status(400).json({ error: 'Commande invalide' });
        }
        const own = await pool.query(
          'SELECT 1 FROM orders WHERE wp_order_id = $1 AND wp_customer_id = $2 LIMIT 1',
          [wpOrderId, wpUserId]
        );
        if (own.rows.length === 0) {
          // La commande n'est pas celle du client : on refuse sans en dire plus.
          return res.status(403).json({ error: 'Commande non autorisée' });
        }
        order_id = String(wpOrderId);
      }

      // 3. Identité du client (nom + email) depuis la fiche, jamais depuis le body
      const custRes = await pool.query(
        'SELECT first_name, last_name, email FROM customers WHERE id = $1 LIMIT 1',
        [customerId]
      );
      const cust = custRes.rows[0] || {};
      const customer_name = `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'Client';
      const customer_email = (req.clientEmail || cust.email || '').toLowerCase();

      // 4. Création du ticket (source='account' → visible dans l'espace client)
      const ticket = await savModel.create({
        order_id,
        customer_id: customerId,
        customer_name,
        customer_email,
        customer_phone: null,
        subject,
        description: null,
        source: CLIENT_TICKET_SOURCE,
      });

      // 5. Pièces jointes (mêmes stockage/URLs que le SAV agent)
      const storedAttachments = saveAttachments(ticket.id, req.files);

      // 6. Premier message du client. Le produit concerné (libellé texte) est
      // préfixé au corps pour donner le contexte à l'agent.
      const messageText = product
        ? `Produit concerné : ${product}\n\n${body}`
        : body;

      await savModel.addMessage(ticket.id, {
        from: customer_name,
        body: plainTextToSafeHtml(messageText),
        is_agent: false,
        is_private: false,
        attachments: storedAttachments,
      });

      res.status(201).json({ success: true, ticket_id: ticket.id });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur createMyTicket:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Commandes du client connecté (pour le sélecteur de création) ─────────
  // Réutilise la logique de savController.getCustomerOrders, scopée sur le
  // wp_user_id résolu par le middleware (jamais un paramètre d'URL).
  getMyOrders: async (req, res) => {
    try {
      const wpUserId = req.clientWpUserId;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);

      const ordersRes = await pool.query(
        `SELECT wp_order_id, post_date, post_status, order_total, tracking_number, shipping_carrier
         FROM orders WHERE wp_customer_id = $1
         ORDER BY post_date DESC LIMIT $2`,
        [wpUserId, limit]
      );

      const orders = ordersRes.rows;
      for (const order of orders) {
        const itemsRes = await pool.query(
          `SELECT oi.order_item_name, oi.qty, oi.line_total, p.sku, p.image_url
           FROM order_items oi
           LEFT JOIN products p ON p.wp_product_id = COALESCE(oi.variation_id, oi.product_id)
           WHERE oi.wp_order_id = $1 AND oi.order_item_type = 'line_item'
           ORDER BY oi.id`,
          [order.wp_order_id]
        );
        order.items = itemsRes.rows;
      }

      res.json({ success: true, orders });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur getMyOrders:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Administration du secret (onglet DANGER de l'app). Ces handlers sont montés
  // sur la surface APP (/api/sav/...), pas sur /api/client-sav.
  // ───────────────────────────────────────────────────────────────────────────

  // GET — état du secret. Masqué par défaut ; le secret complet n'est renvoyé
  // que si ?reveal=1 (clic explicite "Afficher" dans l'UI).
  getSecret: async (req, res) => {
    try {
      const secret = await getClientSavSecret();
      const configured = !!secret;
      const reveal = req.query.reveal === '1' || req.query.reveal === 'true';

      let preview = null;
      if (configured) {
        // Aperçu masqué : 4 premiers caractères + longueur, jamais tout le secret.
        preview = `${secret.slice(0, 4)}••••••••(${secret.length})`;
      }

      // URL publique de l'API à renseigner dans le plugin WordPress.
      const appBaseUrl = process.env.APP_BASE_URL || 'https://apps.youvape.fr';

      res.json({
        success: true,
        configured,
        preview,
        secret: reveal && configured ? secret : null,
        api_url: appBaseUrl,
      });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur getSecret:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // PUT — définit le secret (saisie manuelle). Borne la longueur min pour éviter
  // un secret trivial.
  setSecret: async (req, res) => {
    try {
      const value = (req.body.secret || '').toString().trim();
      if (value.length < 24) {
        return res.status(400).json({ error: 'Le secret doit faire au moins 24 caractères.' });
      }
      if (value.length > 200) {
        return res.status(400).json({ error: 'Secret trop long.' });
      }
      await appConfigModel.upsert(CLIENT_SAV_SECRET_KEY, value);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur setSecret:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // POST generate — génère un secret fort, le stocke, et le renvoie une fois
  // (pour que l'admin puisse le copier dans le plugin WP).
  generateSecret: async (req, res) => {
    try {
      const value = crypto.randomBytes(32).toString('hex'); // 64 caractères hex
      await appConfigModel.upsert(CLIENT_SAV_SECRET_KEY, value);
      res.json({ success: true, secret: value });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur generateSecret:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = clientSavController;
