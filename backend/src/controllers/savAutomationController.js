const savAutomationModel = require('../models/savAutomationModel');
const { runOne } = require('../services/automationRunner');

const VALID_TYPES = new Set(['status_since', 'no_customer_reply', 'no_agent_action']);
const VALID_UNITS = new Set(['hours', 'days']);

function validateConditions(conditions) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return 'Au moins une condition est requise';
  }
  for (const c of conditions) {
    if (!c || !VALID_TYPES.has(c.type))                    return 'Type de condition invalide';
    if (!VALID_UNITS.has(c.unit))                          return 'Unité invalide (heures ou jours)';
    const v = parseInt(c.value, 10);
    if (!Number.isFinite(v) || v <= 0)                     return 'Valeur invalide (> 0)';
  }
  return null;
}

function validatePayload({ name, conditions, target_status, filter_status }) {
  if (!name || !name.trim())          return 'Nom requis';
  if (!target_status)                 return 'Statut cible requis';
  if (filter_status && filter_status === target_status) {
    return 'Le statut cible ne peut pas être identique au statut source (boucle infinie)';
  }
  return validateConditions(conditions);
}

// Normalise les conditions avant stockage (entier + unité validée)
function normalizeConditions(conditions) {
  return conditions.map(c => ({
    type:  c.type,
    value: parseInt(c.value, 10),
    unit:  c.unit,
  }));
}

module.exports = {

  getAll: async (req, res) => {
    try {
      const list = await savAutomationModel.getAll();
      res.json({ success: true, automations: list });
    } catch (e) {
      console.error('❌ [SavAutomation] getAll:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  create: async (req, res) => {
    try {
      const { name, description, filter_status, conditions, target_status, enabled } = req.body;
      const err = validatePayload({ name, conditions, target_status, filter_status });
      if (err) return res.status(400).json({ error: err });

      const auto = await savAutomationModel.create({
        name: name.trim(),
        description: description || null,
        filter_status: filter_status || null,
        conditions: normalizeConditions(conditions),
        target_status,
        enabled,
      });
      res.status(201).json({ success: true, automation: auto });
    } catch (e) {
      console.error('❌ [SavAutomation] create:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  update: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savAutomationModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Automatisme introuvable' });

      const fields = {};

      // Toggle simple
      if (typeof req.body.enabled === 'boolean') fields.enabled = req.body.enabled;

      // Édition complète : si l'un des champs métiers est fourni, valider l'ensemble
      const editing = ['name', 'description', 'filter_status', 'conditions', 'target_status']
        .some(k => req.body[k] !== undefined);
      if (editing) {
        const merged = {
          name:          req.body.name          ?? existing.name,
          description:   req.body.description   ?? existing.description,
          filter_status: req.body.filter_status ?? existing.filter_status,
          conditions:    req.body.conditions    ?? existing.conditions,
          target_status: req.body.target_status ?? existing.target_status,
        };
        const err = validatePayload(merged);
        if (err) return res.status(400).json({ error: err });
        fields.name          = merged.name.trim();
        fields.description   = merged.description || null;
        fields.filter_status = merged.filter_status || null;
        fields.conditions    = normalizeConditions(merged.conditions);
        fields.target_status = merged.target_status;
      }

      if (Object.keys(fields).length === 0) {
        return res.status(400).json({ error: 'Aucun champ à modifier' });
      }
      const updated = await savAutomationModel.update(id, fields);
      res.json({ success: true, automation: updated });
    } catch (e) {
      console.error('❌ [SavAutomation] update:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  delete: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const existing = await savAutomationModel.getById(id);
      if (!existing) return res.status(404).json({ error: 'Automatisme introuvable' });
      await savAutomationModel.delete(id);
      res.json({ success: true });
    } catch (e) {
      console.error('❌ [SavAutomation] delete:', e);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Lancement manuel d'un automatisme (debug / test)
  runNow: async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const auto = await savAutomationModel.getById(id);
      if (!auto) return res.status(404).json({ error: 'Automatisme introuvable' });
      const r = await runOne(auto);
      // Renvoyer aussi la règle mise à jour pour rafraîchir le UI
      const fresh = await savAutomationModel.getById(id);
      res.json({ success: true, result: r, automation: fresh });
    } catch (e) {
      console.error('❌ [SavAutomation] runNow:', e);
      res.status(500).json({ error: e.message || 'Erreur serveur' });
    }
  },
};
