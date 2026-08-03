const crypto = require('crypto');
const pool = require('../config/database');
const savModel = require('../models/savModel');
const appConfigModel = require('../models/appConfigModel');
const { saveAttachments } = require('../utils/savAttachments');
const { dispatchNotifications } = require('../services/notificationDispatcher');
const { getClientSavSecret, CLIENT_SAV_SECRET_KEY } = require('../utils/clientSavSecret');
const { sendAckEmail } = require('../utils/savAckEmail');

// Statut appliqué à un ticket quand le client (ré)agit : remonte le ticket dans
// la file agent. Identique au comportement d'un email inbound client.
const CLIENT_REPLY_STATUS = 'reponse_client';

// Limites de validation des entrées client (création de ticket)
const MAX_SUBJECT_LEN = 150;
const MAX_BODY_LEN = 10000;
const MAX_PRODUCT_LABEL_LEN = 200;
const MAX_PRODUCTS = 30;
// Formulaire public : identité saisie librement, donc bornée.
const MAX_NAME_LEN = 100;
const MAX_EMAIL_LEN = 200;

/**
 * Motifs de demande proposés au client (le "sujet" du ticket n'est plus saisi
 * librement : il est déduit ici du motif choisi). Le plugin envoie le SLUG ;
 * le sujet vient de cette table côté serveur — jamais du navigateur.
 *
 * ⚠️ `subject` est repris tel quel comme OBJET DES EMAILS envoyés au client
 * (accusé de réception, réponses agent) : c'est une formulation orientée client,
 * différente du libellé du choix dans le formulaire ("Une difficulté avec un
 * produit" côté boutique → "Votre demande d'assistance YouVape" côté email).
 *
 * `requestReason` alimente la colonne `sav_tickets.request_reason`, déjà remplie
 * par le webhook Gravity Forms et déjà affichée dans le détail du ticket côté
 * app agent (TicketDetail.jsx humanise le slug : _ → espaces + capitale). Le
 * libellé lisible est donc obtenu sans toucher au front.
 * ⚠️ Vocabulaire volontairement distinct des slugs GF existants
 * (`un_conseil_avant_de_passer_commande`, `une_commande_que_j_ai_passée`) : à
 * unifier si l'on veut un jour filtrer les deux sources sur le même axe.
 *
 * Chaque motif porte ses règles métier, revérifiées serveur (le formulaire les
 * applique aussi, mais un POST forgé ne doit pas pouvoir les contourner) :
 *   - requiresOrder    : une commande du client est obligatoire
 *   - requiresProducts : au moins un produit de cette commande est obligatoire
 *   - requiresBody     : le texte libre est obligatoire
 */
const CLIENT_TICKET_REASONS = {
  question: {
    subject: 'Votre question au service client YouVape',
    requestReason: 'question_avant_commande',
    requiresOrder: false,
    requiresProducts: false,
    requiresBody: true,
  },
  produit: {
    subject: 'Votre demande d\'assistance YouVape',
    requestReason: 'difficulté_avec_une_commande',
    requiresOrder: true,
    requiresProducts: true,
    requiresBody: true,
  },
  retractation: {
    subject: 'Votre demande de rétractation YouVape',
    requestReason: 'demande_de_rétractation',
    requiresOrder: true,
    requiresProducts: true,
    // Le client n'a pas à motiver sa rétractation (art. L221-18) : la commande
    // et les produits suffisent, le commentaire est facultatif.
    requiresBody: false,
  },
};

/**
 * Normalise les produits concernés reçus du formulaire. Le champ `products`
 * peut arriver en tableau (plusieurs cases cochées), en chaîne (une seule) ou
 * absent. On borne, on nettoie et on dédoublonne.
 *
 * @param {*} raw valeur brute de req.body.products (ou de l'ancien `product`)
 * @returns {string[]} libellés produits, sans doublon ni valeur vide
 */
function normalizeProducts(raw) {
  if (raw === undefined || raw === null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (const item of list) {
    if (item === undefined || item === null) continue;
    const name = String(item).trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

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
const CLIENT_TICKET_SOURCE = 'account';        // créé depuis l'espace client connecté
const PUBLIC_TICKET_SOURCE = 'public';         // créé depuis le formulaire public (non connecté)
const AGENT_DISPLAY_NAME = 'Service client YouVape';

/**
 * Origines de tickets visibles par le client dans son espace.
 * `zendesk`, `email` et `manual` en sont volontairement exclus : ce sont des
 * fils créés côté agent ou importés, dont le client n'a jamais eu de vue web.
 */
const CLIENT_VISIBLE_SOURCES = [CLIENT_TICKET_SOURCE, PUBLIC_TICKET_SOURCE, 'gravity_form'];

/**
 * Clause d'appartenance d'un ticket au client connecté. UNE seule définition,
 * réutilisée par la liste, le détail et la réponse — si ces trois vues
 * divergeaient, un client pourrait voir un ticket auquel il ne pourrait pas
 * répondre, ou pire, l'inverse.
 *
 * Deux façons d'être propriétaire :
 *   1. le ticket porte son customer_id (cas normal) ;
 *   2. le ticket est orphelin (customer_id NULL) et porte SON adresse email —
 *      cas d'une demande déposée via le formulaire public ou Gravity Forms
 *      avant que son compte n'existe. Le rattachement se fait ainsi à la
 *      lecture, sans backfill ni cron.
 *
 * ⚠️ $2 (email) DOIT provenir de la fiche `customers` résolue par le middleware
 * depuis la session WordPress — jamais d'une valeur fournie dans la requête,
 * sinon n'importe qui lirait les tickets de n'importe qui.
 *
 * Ordre des paramètres imposé : $1 = customers.id, $2 = email, $3 = sources.
 */
const CLIENT_OWNERSHIP_SQL = `(
    t.customer_id = $1
    OR (
      t.customer_id IS NULL
      AND $2::text IS NOT NULL
      AND lower(t.customer_email) = lower($2::text)
    )
  )
  AND t.source = ANY($3::text[])`;

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
           COALESCE(NULLIF(s.client_label, ''), $4) AS status_label,
           jsonb_array_length(COALESCE(t.messages, '[]'::jsonb))
             + CASE WHEN COALESCE(t.description, '') <> '' THEN 1 ELSE 0 END AS message_count
         FROM sav_tickets t
         LEFT JOIN sav_ticket_statuses s ON s.value = t.sav_status
         WHERE ${CLIENT_OWNERSHIP_SQL}
         ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC`,
        [customerId, req.clientEmail, CLIENT_VISIBLE_SOURCES, DEFAULT_CLIENT_LABEL]
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
           t.description_attachments,
           t.order_id,
           t.created_at,
           t.updated_at,
           t.customer_name,
           t.messages,
           COALESCE(NULLIF(s.client_label, ''), $5) AS status_label
         FROM sav_tickets t
         LEFT JOIN sav_ticket_statuses s ON s.value = t.sav_status
         WHERE t.id = $4
           AND ${CLIENT_OWNERSHIP_SQL}`,
        [customerId, req.clientEmail, CLIENT_VISIBLE_SOURCES, ticketId, DEFAULT_CLIENT_LABEL]
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

      // Les tickets Gravity Forms rangent la demande initiale dans `description`
      // (avec ses PJ dans `description_attachments`), pas dans `messages` —
      // l'app agent la rend déjà comme 1er message du fil. Sans ce rappel, le
      // client verrait son propre fil amputé de sa demande d'origine.
      // Texte brut côté GF, donc échappé puis converti en HTML sûr.
      if (row.description && String(row.description).trim()) {
        messages.unshift({
          from: row.customer_name || 'Vous',
          is_agent: false,
          body: plainTextToSafeHtml(String(row.description).trim()),
          date: row.created_at || null,
          attachments: Array.isArray(row.description_attachments) ? row.description_attachments : [],
        });
      }

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
      // Même clause que la liste et le détail : tout ticket qu'il voit, il peut
      // y répondre.
      const ticketRes = await pool.query(
        `SELECT t.id, t.customer_name, t.customer_email, t.subject, t.sav_status
         FROM sav_tickets t
         WHERE t.id = $4 AND ${CLIENT_OWNERSHIP_SQL}`,
        [customerId, req.clientEmail, CLIENT_VISIBLE_SOURCES, ticketId]
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

      const body      = (req.body.body || '').toString().trim();
      const orderRaw  = req.body.order_id;
      const reasonKey = (req.body.reason || '').toString().trim();

      // 1. Motif → sujet du ticket. Le libellé vient de CLIENT_TICKET_REASONS,
      // jamais du navigateur. `subject` reste accepté en repli pour rester
      // compatible avec une version antérieure du plugin encore déployée.
      let reason = null;
      if (reasonKey) {
        if (!Object.prototype.hasOwnProperty.call(CLIENT_TICKET_REASONS, reasonKey)) {
          return res.status(400).json({ error: 'Motif invalide' });
        }
        reason = CLIENT_TICKET_REASONS[reasonKey];
      }
      const subject = reason ? reason.subject : (req.body.subject || '').toString().trim();

      // Produits concernés : plusieurs choix possibles (`products`), ou l'ancien
      // champ unique `product`.
      let products = normalizeProducts(
        req.body.products !== undefined ? req.body.products : req.body.product
      );

      // 2. Validation des champs. Le texte libre est obligatoire partout sauf
      // pour la rétractation (et reste exigé sur l'ancien chemin sans motif).
      if (!subject) {
        return res.status(400).json({ error: 'Le motif de la demande est requis' });
      }
      const bodyRequired = reason ? reason.requiresBody !== false : true;
      if (bodyRequired && !body) {
        return res.status(400).json({ error: 'Le message est requis' });
      }
      if (subject.length > MAX_SUBJECT_LEN) {
        return res.status(400).json({ error: 'Sujet trop long' });
      }
      if (body.length > MAX_BODY_LEN) {
        return res.status(400).json({ error: 'Message trop long' });
      }
      if (products.length > MAX_PRODUCTS) {
        return res.status(400).json({ error: 'Trop de produits sélectionnés' });
      }
      if (products.some((p) => p.length > MAX_PRODUCT_LABEL_LEN)) {
        return res.status(400).json({ error: 'Produit concerné invalide' });
      }
      if (reason && reason.requiresProducts && products.length === 0) {
        return res.status(400).json({ error: 'Sélectionnez au moins un produit concerné' });
      }

      // 3. Commande — obligatoire ou non selon le motif, et dans tous les cas
      // vérifiée comme appartenant au client (anti-IDOR).
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
      if (reason && reason.requiresOrder && !order_id) {
        return res.status(400).json({ error: 'Sélectionnez la commande concernée' });
      }
      // Motif sans commande : on ignore toute commande/produit reçus malgré tout
      // (champs masqués côté formulaire), pour ne pas produire de ticket
      // incohérent avec son sujet.
      if (reason && !reason.requiresOrder) {
        order_id = null;
        products = [];
      }

      // 4. Identité du client (nom + email) depuis la fiche, jamais depuis le body
      const custRes = await pool.query(
        'SELECT first_name, last_name, email FROM customers WHERE id = $1 LIMIT 1',
        [customerId]
      );
      const cust = custRes.rows[0] || {};
      const customer_name = `${cust.first_name || ''} ${cust.last_name || ''}`.trim() || 'Client';
      const customer_email = (req.clientEmail || cust.email || '').toLowerCase();

      // 5. Création du ticket (source='account' → visible dans l'espace client)
      const ticket = await savModel.create({
        order_id,
        customer_id: customerId,
        customer_name,
        customer_email,
        customer_phone: null,
        subject,
        description: null,
        source: CLIENT_TICKET_SOURCE,
        // Type de demande, exploitable par l'app agent (null si ancien plugin).
        request_reason: reason ? reason.requestReason : null,
      });

      // 6. Pièces jointes (mêmes stockage/URLs que le SAV agent)
      const storedAttachments = saveAttachments(ticket.id, req.files);

      // 7. Premier message du client. Les produits concernés (libellés texte)
      // sont préfixés au corps pour donner le contexte à l'agent. Le corps peut
      // être vide (rétractation sans commentaire) : on n'ajoute alors que la
      // liste des produits, sans ligne vide en fin de message.
      const blocks = [];
      if (products.length === 1) {
        blocks.push(`Produit concerné : ${products[0]}`);
      } else if (products.length > 1) {
        blocks.push(`Produits concernés :\n${products.map((p) => `- ${p}`).join('\n')}`);
      }
      if (body) blocks.push(body);
      const messageText = blocks.join('\n\n');

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

  // ─── Création publique (visiteur NON connecté) ────────────────────────────
  // Surface montée sur /api/client-sav-public : le secret prouve que l'appel
  // vient de notre WordPress, mais il n'y a aucune identité vérifiée. On ne
  // crée donc qu'un ticket "question avant commande" : ni commande, ni produit,
  // rien à autoriser, rien à divulguer. Écriture seule, jamais de lecture.
  //
  // L'email saisi n'est pas vérifié : on s'en sert pour rattacher une fiche
  // client existante et pour répondre. C'est exactement le modèle du webhook
  // Gravity Forms qu'il remplace.
  createPublicTicket: async (req, res) => {
    try {
      const name  = (req.body.name || '').toString().trim();
      const email = (req.body.email || '').toString().trim().toLowerCase();
      const body  = (req.body.body || '').toString().trim();

      if (!name || !email || !body) {
        return res.status(400).json({ error: 'Nom, email et message sont requis' });
      }
      if (name.length > MAX_NAME_LEN) {
        return res.status(400).json({ error: 'Nom trop long' });
      }
      if (email.length > MAX_EMAIL_LEN || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Adresse email invalide' });
      }
      if (body.length > MAX_BODY_LEN) {
        return res.status(400).json({ error: 'Message trop long' });
      }

      const reason = CLIENT_TICKET_REASONS.question;

      // Rattachement à une fiche client existante par email. Introuvable ⇒
      // customer_id NULL : le ticket sera rattaché à la lecture, le jour où la
      // personne se crée un compte avec cette adresse (voir CLIENT_OWNERSHIP_SQL).
      const custRes = await pool.query(
        'SELECT id FROM customers WHERE lower(email) = $1 LIMIT 1',
        [email]
      );
      const customerId = custRes.rows[0] ? custRes.rows[0].id : null;

      const ticket = await savModel.create({
        order_id: null,
        customer_id: customerId,
        customer_name: name,
        customer_email: email,
        customer_phone: null,
        subject: reason.subject,
        description: null,
        source: PUBLIC_TICKET_SOURCE,
        request_reason: reason.requestReason,
      });

      const storedAttachments = saveAttachments(ticket.id, req.files);

      await savModel.addMessage(ticket.id, {
        from: name,
        body: plainTextToSafeHtml(body),
        is_agent: false,
        is_private: false,
        attachments: storedAttachments,
      });

      // Accusé de réception au visiteur + notification agent (fire-and-forget) :
      // un échec d'envoi ne doit pas faire échouer la demande.
      sendAckEmail({
        ticketId: ticket.id, email, customerName: name, subject: reason.subject,
      });
      dispatchNotifications('new_message', ticket).catch(() => {});

      res.status(201).json({ success: true, ticket_id: ticket.id });
    } catch (error) {
      console.error('❌ [Client SAV] Erreur createPublicTicket:', error);
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
        // post_modified sert de date de livraison approchée quand la commande est
        // en 'wc-delivered' (pas d'historique de statut en base) : le plugin s'en
        // sert pour signaler un délai de rétractation vraisemblablement dépassé.
        `SELECT wp_order_id, post_date, post_modified, post_status, order_total,
                tracking_number, shipping_carrier
         FROM orders WHERE wp_customer_id = $1
         ORDER BY post_date DESC LIMIT $2`,
        [wpUserId, limit]
      );

      const orders = ordersRes.rows;
      for (const order of orders) {
        const itemsRes = await pool.query(
          `SELECT oi.order_item_name, oi.qty, oi.line_total, p.sku, p.image_url
           FROM order_items oi
           LEFT JOIN products p ON p.wp_product_id = COALESCE(NULLIF(oi.variation_id, 0), oi.product_id)
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
