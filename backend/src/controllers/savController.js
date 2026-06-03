const savModel = require('../models/savModel');
const savViewModel = require('../models/savViewModel');
const mailgunService = require('../services/mailgunService');
const pool = require('../config/database');
const { saveAttachments, toMailgunAttachments } = require('../utils/savAttachments');
const { getTrackingStatus } = require('../services/trackingService');
const { dispatchNotifications } = require('../services/notificationDispatcher');
const { tagDuplicates } = require('../services/duplicateDetector');
const { mergeTickets } = require('../services/ticketMerge');

const savController = {

  // ─── Webhook Gravity Forms — création ticket ──────────────────────────────
  webhookGravityForms: async (req, res) => {
    try {
      // Vérification secret
      const secret = req.headers['x-webhook-secret'];
      if (!secret || secret !== process.env.SAV_WEBHOOK_SECRET) {
        console.warn('⚠️ [SAV Webhook] Secret invalide');
        return res.status(401).json({ error: 'Non autorisé' });
      }

      const body = req.body;
      console.log('📥 [SAV Webhook] Payload reçu:', JSON.stringify(body, null, 2));

      // Mapping champs Gravity Forms
      const prenom      = body['1.3'] || '';
      const nom         = body['1.6'] || '';
      const email       = body['2']   || '';
      const order_id    = body['9']   || null;
      const description = body['4']   || '';

      if (!email || !description) {
        return res.status(400).json({ error: 'Email et description requis' });
      }

      const customer_name  = `${prenom} ${nom}`.trim();
      const customer_phone = body['3'] || null; // si champ téléphone existe
      const subject        = description.substring(0, 100); // premiers 100 chars comme sujet

      // Chercher le client par email
      let customer_id = null;
      if (email) {
        const customerResult = await pool.query(
          'SELECT id FROM customers WHERE email = $1 LIMIT 1',
          [email.toLowerCase()]
        );
        if (customerResult.rows.length > 0) {
          customer_id = customerResult.rows[0].id;
        }
      }

      const ticket = await savModel.create({
        order_id:       order_id || null,
        customer_id,
        customer_name,
        customer_email: email.toLowerCase(),
        customer_phone,
        subject,
        description,
        source: 'gravity_form',
      });

      console.log(`✅ [SAV] Ticket #${ticket.id} créé pour ${customer_name} (${email})`);

      // Notification : nouveau message reçu (fire-and-forget)
      dispatchNotifications('new_message', ticket).catch(() => {});

      // Détection de doublons (fire-and-forget)
      tagDuplicates(ticket).catch(e => console.warn('[SAV] tagDuplicates échoué:', e.message));

      res.status(200).json({ success: true, ticket_id: ticket.id });

    } catch (error) {
      console.error('❌ [SAV] Erreur webhook GF:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Inbound email Mailgun — réponse client ───────────────────────────────
  inboundEmail: async (req, res) => {
    try {
      // Toujours répondre 200 rapidement à Mailgun (sinon il retry)
      res.status(200).json({ success: true });

      console.log('📨 [SAV Inbound] Payload reçu:', JSON.stringify(req.body, null, 2));

      const { sender, subject, 'body-plain': bodyPlain, timestamp, token, signature } = req.body;

      // Vérifier signature Mailgun (optionnel en sandbox)
      if (process.env.MAILGUN_WEBHOOK_SIGNING_KEY) {
        const valid = mailgunService.verifyWebhookSignature(timestamp, token, signature);
        if (!valid) {
          console.warn('⚠️ [SAV Inbound] Signature Mailgun invalide');
          return;
        }
      }

      // Extraire ticket ID du sujet pour matcher à un ticket existant.
      // Si le ticket a été fusionné dans un autre, on suit la chaîne jusqu'au
      // ticket actif (sinon la réponse atterrirait dans un ticket fermé/mort).
      const ticketId = mailgunService.extractTicketIdFromSubject(subject);
      const matchedTicket = ticketId ? await savModel.resolveActiveTicket(ticketId) : null;
      if (matchedTicket && ticketId && matchedTicket.id !== ticketId) {
        console.log(`📨 [SAV Inbound] Ticket #${ticketId} fusionné → réponse redirigée vers #${matchedTicket.id}`);
      }

      // Nettoyer le body (enlever les parties quotées des réponses email)
      const cleanBody = bodyPlain
        ? bodyPlain.split(/^On .+ wrote:/m)[0].trim()
        : '';

      // ─── Cas 1 : ticket trouvé → ajouter la réponse au fil existant ─────
      if (matchedTicket) {
        const attachments = saveAttachments(matchedTicket.id, req.files);
        if (!cleanBody && attachments.length === 0) return;

        await savModel.addMessage(matchedTicket.id, {
          from:        sender,
          body:        cleanBody,
          is_agent:    false,
          attachments,
        });

        // Rouvrir le ticket si terminé/refusé
        if (['terminé', 'refusé'].includes(matchedTicket.sav_status)) {
          await savModel.updateStatus(matchedTicket.id, 'ouvert');
        }

        console.log(`📨 [SAV Inbound] Réponse client ajoutée au ticket #${matchedTicket.id}`);

        dispatchNotifications('reply_received', matchedTicket, {
          body: cleanBody, from: sender,
        }).catch(() => {});
        return;
      }

      // ─── Cas 2 : pas de match → créer un nouveau ticket ─────────────────
      if (!cleanBody && (!req.files || req.files.length === 0)) {
        console.warn(`⚠️ [SAV Inbound] Mail vide rejeté (sender=${sender})`);
        return;
      }

      // Nettoyer "Re: " du sujet
      const cleanSubject = (subject || '(sans sujet)')
        .replace(/^\s*(Re\s*:\s*)+/i, '')
        .replace(/\[SAV #\d+\]\s*/i, '')
        .trim() || '(sans sujet)';

      // Lookup client par email
      let customer_id = null;
      let customer_name = sender;
      try {
        const customerResult = await pool.query(
          'SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1',
          [sender.toLowerCase()]
        );
        if (customerResult.rows.length > 0) {
          customer_id = customerResult.rows[0].id;
          const c = customerResult.rows[0];
          customer_name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || sender;
        }
      } catch (e) {
        console.warn('[SAV Inbound] Lookup customer échoué:', e.message);
      }

      const newTicket = await savModel.create({
        order_id:       null,
        customer_id,
        customer_name,
        customer_email: sender.toLowerCase(),
        customer_phone: null,
        subject:        cleanSubject.substring(0, 200),
        description:    cleanBody,
        source:         'email',
      });

      // Sauvegarder les PJ avec le nouvel id
      saveAttachments(newTicket.id, req.files);

      console.log(`✅ [SAV Inbound] Nouveau ticket #${newTicket.id} créé depuis email "${cleanSubject}" (sender=${sender})`);

      dispatchNotifications('new_message', newTicket).catch(() => {});
      tagDuplicates(newTicket).catch(e => console.warn('[SAV Inbound] tagDuplicates échoué:', e.message));

    } catch (error) {
      console.error('❌ [SAV Inbound] Erreur:', error);
    }
  },

  // ─── Liste des tickets ────────────────────────────────────────────────────
  getAll: async (req, res) => {
    try {
      const { limit = 50, offset = 0, sav_status, sav_statuses, search } = req.query;
      // sav_statuses peut arriver comme ?sav_statuses[]=ouvert&sav_statuses[]=accepté
      const statusesArray = sav_statuses
        ? (Array.isArray(sav_statuses) ? sav_statuses : [sav_statuses])
        : null;
      const { tickets, total } = await savModel.getAll({
        limit:         parseInt(limit),
        offset:        parseInt(offset),
        sav_status:    sav_status || null,
        sav_statuses:  statusesArray,
        search:        search || null,
      });
      res.json({ success: true, tickets, total });
    } catch (error) {
      console.error('❌ [SAV] Erreur liste:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Détail ticket ────────────────────────────────────────────────────────
  getById: async (req, res) => {
    try {
      const ticket = await savModel.getById(parseInt(req.params.id));
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur détail:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Tickets par commande ─────────────────────────────────────────────────
  getByOrderId: async (req, res) => {
    try {
      const tickets = await savModel.getByOrderId(req.params.order_id);
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('❌ [SAV] Erreur tickets commande:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Tickets par client ───────────────────────────────────────────────────
  getByCustomerId: async (req, res) => {
    try {
      const tickets = await savModel.getByCustomerId(parseInt(req.params.customer_id));
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('❌ [SAV] Erreur tickets client:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Mise à jour statut ───────────────────────────────────────────────────
  updateStatus: async (req, res) => {
    try {
      const { sav_status } = req.body;
      const ticket = await savModel.updateStatus(parseInt(req.params.id), sav_status);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur statut:', error);
      res.status(400).json({ error: error.message });
    }
  },

  // ─── Répondre au client par email ────────────────────────────────────────
  reply: async (req, res) => {
    try {
      const ticketId = parseInt(req.params.id);
      const { body, agent_name, is_private } = req.body;

      if (!body) return res.status(400).json({ error: 'Le message est requis' });

      const ticket = await savModel.getById(ticketId);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });

      const from = agent_name || 'SAV Youvape';
      const storedAttachments = saveAttachments(ticketId, req.files);

      // Note privée → pas d'envoi email, juste stockage
      if (is_private === 'true' || is_private === true) {
        const updated = await savModel.addMessage(ticketId, {
          from, body, is_agent: true, is_private: true,
          attachments: storedAttachments,
        });
        return res.json({ success: true, ticket: updated });
      }

      // Réponse publique → envoi email via Mailgun
      const emailResult = await mailgunService.sendReply({
        to:          ticket.customer_email,
        subject:     ticket.subject,
        ticketId,
        bodyText:    body,
        attachments: toMailgunAttachments(req.files),
      });

      if (!emailResult.success) {
        return res.status(500).json({ error: `Erreur envoi email: ${emailResult.error}` });
      }

      // Stocker le message dans le ticket
      const updated = await savModel.addMessage(ticketId, {
        from, body, is_agent: true, is_private: false,
        attachments: storedAttachments,
      });

      res.json({ success: true, ticket: updated });

    } catch (error) {
      console.error('❌ [SAV] Erreur reply:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Fusionner ce ticket (source) dans un ticket cible ───────────────────
  // POST /:id/merge  body: { target_id, agent_name? }
  // Façon Zendesk : le ticket courant (:id) est absorbé par target_id puis fermé.
  mergeTicket: async (req, res) => {
    try {
      const sourceId = parseInt(req.params.id);
      const targetId = parseInt(req.body.target_id);

      if (Number.isNaN(sourceId) || Number.isNaN(targetId)) {
        return res.status(400).json({ error: 'target_id invalide' });
      }
      if (sourceId === targetId) {
        return res.status(400).json({ error: 'Impossible de fusionner un ticket avec lui-même' });
      }

      const targetTicket = await mergeTickets(sourceId, targetId, {
        agentName: req.body.agent_name || 'SAV Youvape',
      });

      // Renvoyer la cible enrichie (order_items, infos client…)
      const fullTarget = await savModel.getById(targetTicket.id);
      res.json({ success: true, ticket: fullTarget });
    } catch (error) {
      console.error('❌ [SAV] Erreur fusion:', error);
      res.status(400).json({ error: error.message || 'Erreur serveur' });
    }
  },

  // ─── Mise à jour notes internes ───────────────────────────────────────────
  updateNotes: async (req, res) => {
    try {
      const { notes } = req.body;
      const ticket = await savModel.updateNotes(parseInt(req.params.id), notes);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur notes:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── PATCH champs éditables (autosave 600ms debounce) ────────────────────
  patchTicket: async (req, res) => {
    try {
      const ticket = await savModel.patch(parseInt(req.params.id), req.body);
      if (!ticket) return res.status(404).json({ error: 'Ticket introuvable ou aucun champ valide' });
      res.json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur patch:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Créer un ticket manuellement (depuis l'app) ─────────────────────────
  // Body requis : un 1er message (public ou note privée). Si public, envoi mail.
  createManual: async (req, res) => {
    try {
      const {
        order_id, customer_name, customer_email, customer_phone,
        subject, body, is_private, sav_status, assigned_to_id, agent_name,
      } = req.body;

      if (!customer_email || !subject || !body || !body.trim()) {
        return res.status(400).json({ error: 'Email, sujet et message sont requis' });
      }

      // Lookup client par email (priorité à la BDD : si trouvé, on ignore le nom saisi)
      let customer_id = null;
      let resolved_name = customer_name;
      const customerResult = await pool.query(
        'SELECT id, first_name, last_name FROM customers WHERE email = $1 LIMIT 1',
        [customer_email.toLowerCase()]
      );
      if (customerResult.rows.length > 0) {
        customer_id = customerResult.rows[0].id;
        const c = customerResult.rows[0];
        resolved_name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || customer_name;
      }

      const isPrivate = is_private === true || is_private === 'true';

      // Création du ticket (description = null, le 1er message va dans messages[])
      const ticket = await savModel.create({
        order_id: order_id || null,
        customer_id,
        customer_name: resolved_name,
        customer_email: customer_email.toLowerCase(),
        customer_phone: customer_phone || null,
        subject,
        description: null,
        source: 'manual',
      });

      // Appliquer assigné et statut initial si fournis
      const patchFields = {};
      if (assigned_to_id) patchFields.assigned_to_id = assigned_to_id;
      if (Object.keys(patchFields).length > 0) {
        await savModel.patch(ticket.id, patchFields);
      }
      if (sav_status) {
        try { await savModel.updateStatus(ticket.id, sav_status); }
        catch (e) { console.warn('[SAV createManual] statut invalide ignoré:', sav_status, e.message); }
      }

      // Sauvegarde des éventuelles PJ
      const storedAttachments = saveAttachments(ticket.id, req.files);

      // TODO: réactiver l'envoi Mailgun quand la conf sera prête
      // Si réponse publique → envoi mail Mailgun (actuellement désactivé)
      // if (!isPrivate) {
      //   const emailResult = await mailgunService.sendReply({
      //     to:          customer_email.toLowerCase(),
      //     subject:     subject,
      //     ticketId:    ticket.id,
      //     bodyText:    body,
      //     attachments: toMailgunAttachments(req.files),
      //   });
      //   if (!emailResult.success) {
      //     console.error('[SAV createManual] Envoi mail échoué:', emailResult.error);
      //     return res.status(500).json({ error: `Ticket créé mais envoi mail échoué : ${emailResult.error}`, ticket_id: ticket.id });
      //   }
      // }

      // Stocker le 1er message
      await savModel.addMessage(ticket.id, {
        from: agent_name || 'SAV Youvape',
        body,
        is_agent: true,
        is_private: isPrivate,
        attachments: storedAttachments,
      });

      // Détection de doublons (fire-and-forget)
      tagDuplicates(ticket).catch(e => console.warn('[SAV createManual] tagDuplicates échoué:', e.message));

      // Renvoyer le ticket complet (avec enrichissements client, etc.)
      const fullTicket = await savModel.getById(ticket.id);
      res.status(201).json({ success: true, ticket: fullTicket });

    } catch (error) {
      console.error('❌ [SAV] Erreur création manuelle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── CRUD statuts ─────────────────────────────────────────────────────────

  // ─── Historique commandes d'un client (avec articles) ───────────────────────
  // Utilisé par NewTicketPage pour afficher l'historique du client sélectionné.
  getCustomerOrders: async (req, res) => {
    try {
      const wpUserId = parseInt(req.params.wp_user_id);
      if (Number.isNaN(wpUserId)) return res.status(400).json({ error: 'wp_user_id invalide' });

      const limit = parseInt(req.query.limit) || 6;
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
      console.error('❌ [SAV] Erreur getCustomerOrders:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Statut livraison transporteur ───────────────────────────────────────────
  getTracking: async (req, res) => {
    try {
      const { number } = req.params;
      const { carrier } = req.query; // shipping_carrier WooCommerce
      const result = await getTrackingStatus(number, carrier || '');
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('❌ [SAV Tracking]:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── CRUD vues ────────────────────────────────────────────────────────────────

  getViews: async (req, res) => {
    try {
      const views = await savViewModel.getAll();
      res.json({ success: true, views });
    } catch (e) {
      console.error('❌ [SAV Views] getViews:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  createView: async (req, res) => {
    try {
      const { label, statuses } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const view = await savViewModel.create({ label, statuses: statuses || [] });
      res.status(201).json({ success: true, view });
    } catch (e) {
      console.error('❌ [SAV Views] createView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateView: async (req, res) => {
    try {
      const { id } = req.params;
      const { label, statuses } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const view = await savViewModel.update(id, { label, statuses: statuses || [] });
      if (!view) return res.status(404).json({ error: 'Vue introuvable' });
      res.json({ success: true, view });
    } catch (e) {
      console.error('❌ [SAV Views] updateView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  reorderViews: async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids[] requis' });
      await savViewModel.reorder(ids);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SAV Views] reorderViews:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  deleteView: async (req, res) => {
    try {
      await savViewModel.delete(req.params.id);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SAV Views] deleteView:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  getStatuses: async (req, res) => {
    try {
      const statuses = await savModel.statusModel.getAll();
      res.json({ success: true, statuses });
    } catch (error) {
      console.error('❌ [SAV Statuts] getStatuses:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  createStatus: async (req, res) => {
    try {
      const { value, label, bg_color, text_color } = req.body;
      if (!value || !label) return res.status(400).json({ error: 'value et label requis' });
      // Slugifier la valeur
      const slug = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_éàèùâêîôûäëïöüç-]/g, '');
      const status = await savModel.statusModel.create({ value: slug, label: label.trim(), bg_color, text_color });
      res.status(201).json({ success: true, status });
    } catch (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'Ce statut existe déjà' });
      console.error('❌ [SAV Statuts] createStatus:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  updateStatus_s: async (req, res) => {
    try {
      const { id } = req.params;
      const { label, bg_color, text_color } = req.body;
      if (!label) return res.status(400).json({ error: 'label requis' });
      const status = await savModel.statusModel.update(id, { label, bg_color, text_color });
      if (!status) return res.status(404).json({ error: 'Statut introuvable' });
      res.json({ success: true, status });
    } catch (error) {
      console.error('❌ [SAV Statuts] updateStatus_s:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  deleteStatus: async (req, res) => {
    try {
      const { id } = req.params;
      await savModel.statusModel.delete(id);
      res.json({ success: true });
    } catch (error) {
      console.error('❌ [SAV Statuts] deleteStatus:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports = savController;
