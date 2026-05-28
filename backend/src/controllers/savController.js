const savModel = require('../models/savModel');
const savViewModel = require('../models/savViewModel');
const mailgunService = require('../services/mailgunService');
const pool = require('../config/database');
const { saveAttachments, toMailgunAttachments } = require('../utils/savAttachments');
const { getTrackingStatus } = require('../services/trackingService');

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

      // Extraire ticket ID du sujet
      const ticketId = mailgunService.extractTicketIdFromSubject(subject);
      if (!ticketId) {
        console.warn(`⚠️ [SAV Inbound] Pas de ticket ID dans le sujet: "${subject}"`);
        return;
      }

      const ticket = await savModel.findById(ticketId);
      if (!ticket) {
        console.warn(`⚠️ [SAV Inbound] Ticket #${ticketId} introuvable`);
        return;
      }

      // Nettoyer le body (enlever les parties quotées des réponses email)
      const cleanBody = bodyPlain
        ? bodyPlain.split(/^On .+ wrote:/m)[0].trim()
        : '';

      const attachments = saveAttachments(ticketId, req.files);

      if (!cleanBody && attachments.length === 0) return;

      await savModel.addMessage(ticketId, {
        from:        sender,
        body:        cleanBody,
        is_agent:    false,
        attachments,
      });

      // Rouvrir le ticket si terminé/refusé
      if (['terminé', 'refusé'].includes(ticket.sav_status)) {
        await savModel.updateStatus(ticketId, 'ouvert');
      }

      console.log(`📨 [SAV Inbound] Réponse client ajoutée au ticket #${ticketId}`);

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

  // ─── Créer un ticket manuellement ────────────────────────────────────────
  createManual: async (req, res) => {
    try {
      const { order_id, customer_name, customer_email, customer_phone, subject, description } = req.body;
      if (!customer_email || !subject) {
        return res.status(400).json({ error: 'Email et sujet requis' });
      }

      let customer_id = null;
      const customerResult = await pool.query(
        'SELECT id FROM customers WHERE email = $1 LIMIT 1',
        [customer_email.toLowerCase()]
      );
      if (customerResult.rows.length > 0) {
        customer_id = customerResult.rows[0].id;
      }

      const ticket = await savModel.create({
        order_id, customer_id, customer_name, customer_email,
        customer_phone, subject, description, source: 'manual',
      });

      res.status(201).json({ success: true, ticket });
    } catch (error) {
      console.error('❌ [SAV] Erreur création manuelle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── CRUD statuts ─────────────────────────────────────────────────────────

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
