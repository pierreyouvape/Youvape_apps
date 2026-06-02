const savNotificationModel = require('../models/savNotificationModel');

const VALID_TRIGGERS = new Set(['new_message', 'reply_received']);
const VALID_ACTIONS  = new Set(['email']);

// Parse "a@x.fr, b@y.fr ; c@z.fr" -> ['a@x.fr','b@y.fr','c@z.fr']
function parseRecipients(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return [...new Set(
    raw.split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
  )];
}

function isValidEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function validatePayload({ trigger, action, recipients }) {
  if (!VALID_TRIGGERS.has(trigger)) return 'Déclencheur invalide';
  if (!VALID_ACTIONS.has(action))  return 'Action invalide';
  if (action === 'email') {
    const list = parseRecipients(recipients);
    if (list.length === 0)                  return 'Au moins un destinataire requis';
    if (list.some(e => !isValidEmail(e)))   return 'Email(s) invalide(s)';
  }
  return null;
}

module.exports = {

  // ─── Liste (mes notifications) ───────────────────────────────────────────
  getMine: async (req, res) => {
    try {
      const notifs = await savNotificationModel.getAllForUser(req.user.id);
      res.json({ success: true, notifications: notifs });
    } catch (e) {
      console.error('❌ [SavNotif] getMine:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Créer ───────────────────────────────────────────────────────────────
  create: async (req, res) => {
    try {
      const { trigger, action, recipients, enabled } = req.body;
      const err = validatePayload({ trigger, action, recipients });
      if (err) return res.status(400).json({ error: err });

      // Normaliser la liste avant stockage
      const cleaned = parseRecipients(recipients).join(', ');
      const notif = await savNotificationModel.create({
        trigger, action, recipients: cleaned,
        enabled, created_by: req.user.id,
      });
      res.status(201).json({ success: true, notification: notif });
    } catch (e) {
      console.error('❌ [SavNotif] create:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Modifier (édition + toggle enabled) ─────────────────────────────────
  update: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savNotificationModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Notification introuvable' });
      if (existing.created_by !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

      const fields = {};
      // Toggle simple (PATCH enabled uniquement)
      if (typeof req.body.enabled === 'boolean') fields.enabled = req.body.enabled;

      // Édition complète : si l'un des champs métiers est fourni, valider l'ensemble
      if (req.body.trigger !== undefined || req.body.action !== undefined || req.body.recipients !== undefined) {
        const merged = {
          trigger:    req.body.trigger    ?? existing.trigger,
          action:     req.body.action     ?? existing.action,
          recipients: req.body.recipients ?? existing.recipients,
        };
        const err = validatePayload(merged);
        if (err) return res.status(400).json({ error: err });
        fields.trigger    = merged.trigger;
        fields.action     = merged.action;
        fields.recipients = parseRecipients(merged.recipients).join(', ');
      }

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'Aucun champ à modifier' });
      }
      const updated = await savNotificationModel.update(id, fields);
      res.json({ success: true, notification: updated });
    } catch (e) {
      console.error('❌ [SavNotif] update:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // ─── Supprimer ───────────────────────────────────────────────────────────
  delete: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savNotificationModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Notification introuvable' });
      if (existing.created_by !== req.user.id) return res.status(403).json({ error: 'Accès refusé' });

      await savNotificationModel.delete(id);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SavNotif] delete:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },
};

module.exports.parseRecipients = parseRecipients;
