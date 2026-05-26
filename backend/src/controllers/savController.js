const savModel = require('../models/savModel');
const pool = require('../config/database');

const VALID_SAV_STATUSES = ['ouvert', 'accepté', 'terminé', 'refusé'];

const savController = {
  // Créer ou mettre à jour un ticket SAV (appelé depuis Zendesk)
  create: async (req, res) => {
    try {
      const { order_id, customer_email, zendesk_ticket_id, zendesk_ticket_status, notes } = req.body;

      if (!order_id || !zendesk_ticket_id) {
        return res.status(400).json({ error: 'order_id et zendesk_ticket_id sont requis' });
      }

      // Résoudre le customer_id depuis l'email si fourni
      let customer_id = null;
      if (customer_email) {
        const customerResult = await pool.query(
          'SELECT id FROM customers WHERE email = $1 LIMIT 1',
          [customer_email]
        );
        if (customerResult.rows.length > 0) {
          customer_id = customerResult.rows[0].id;
        }
      }

      const ticket = await savModel.create({
        order_id,
        customer_id,
        zendesk_ticket_id,
        zendesk_ticket_status,
        notes
      });

      if (!ticket) {
        // Ticket déjà existant — on retourne l'existant
        const existing = await savModel.getByZendeskId(zendesk_ticket_id);
        return res.json({ success: true, ticket: existing, created: false });
      }

      res.status(201).json({ success: true, ticket, created: true });
    } catch (error) {
      console.error('Erreur création SAV:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer le SAV d'une commande
  getByOrderId: async (req, res) => {
    try {
      const { order_id } = req.params;
      const tickets = await savModel.getByOrderId(order_id);
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('Erreur récupération SAV commande:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer tous les SAV d'un client
  getByCustomerId: async (req, res) => {
    try {
      const { customer_id } = req.params;
      const tickets = await savModel.getByCustomerId(customer_id);
      const total = await savModel.countByCustomerId(customer_id);
      res.json({ success: true, total, tickets });
    } catch (error) {
      console.error('Erreur récupération SAV client:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Mettre à jour le statut SAV et/ou Zendesk
  updateStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { sav_status, zendesk_ticket_status } = req.body;

      if (sav_status && !VALID_SAV_STATUSES.includes(sav_status)) {
        return res.status(400).json({ error: `sav_status invalide. Valeurs acceptées : ${VALID_SAV_STATUSES.join(', ')}` });
      }

      const ticket = await savModel.updateStatus({ id: parseInt(id), sav_status, zendesk_ticket_status });

      if (!ticket) {
        return res.status(404).json({ error: 'Ticket SAV non trouvé' });
      }

      res.json({ success: true, ticket });
    } catch (error) {
      console.error('Erreur mise à jour statut SAV:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Liste tous les tickets SAV (pour le module Youvape Apps)
  getAll: async (req, res) => {
    try {
      const { limit = 50, offset = 0, sav_status } = req.query;
      const tickets = await savModel.getAll({
        limit: parseInt(limit),
        offset: parseInt(offset),
        sav_status
      });
      res.json({ success: true, tickets });
    } catch (error) {
      console.error('Erreur liste SAV:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer un ticket par son ID Zendesk (pour le panel Zendesk)
  getByZendeskId: async (req, res) => {
    try {
      const { zendesk_ticket_id } = req.params;
      const ticket = await savModel.getByZendeskId(zendesk_ticket_id);
      res.json({ success: true, ticket: ticket || null });
    } catch (error) {
      console.error('Erreur récupération SAV Zendesk:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = savController;
