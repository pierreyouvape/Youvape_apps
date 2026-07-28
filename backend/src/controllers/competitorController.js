/**
 * Contrôleur veille concurrentielle : mapping, tableau de bord, historique,
 * déclenchement manuel d'un relevé, et config (email/clé scraping/on-off).
 */
const competitorModel = require('../models/competitorModel');
const appConfigModel = require('../models/appConfigModel');
const { runMonitor } = require('../services/competitorMonitorService');
const { runDiscovery } = require('../services/competitorDiscoveryService');

const competitorController = {
  // GET /api/competitors — liste du mapping
  listProducts: async (req, res) => {
    try {
      const activeOnly = req.query.active === 'true';
      const rows = await competitorModel.listProducts({ activeOnly });
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // GET /api/competitors/dashboard — prix courant + variation par suivi
  dashboard: async (req, res) => {
    try {
      res.json(await competitorModel.getDashboard());
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // GET /api/competitors/:id/history
  history: async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 90, 365);
      res.json(await competitorModel.getHistory(req.params.id, limit));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // POST /api/competitors — créer un suivi
  createProduct: async (req, res) => {
    try {
      const { sku, product_name, competitor, url, active } = req.body;
      if (!sku || !competitor || !url) {
        return res.status(400).json({ error: 'sku, competitor et url sont requis' });
      }
      const row = await competitorModel.createProduct({ sku, product_name, competitor, url, active });
      res.status(201).json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // PUT /api/competitors/:id
  updateProduct: async (req, res) => {
    try {
      const row = await competitorModel.updateProduct(req.params.id, req.body);
      if (!row) return res.status(404).json({ error: 'Suivi introuvable' });
      res.json(row);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // DELETE /api/competitors/:id
  deleteProduct: async (req, res) => {
    try {
      await competitorModel.deleteProduct(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // POST /api/competitors/run — relève maintenant (manuel)
  runNow: async (req, res) => {
    try {
      const notify = req.body?.notify !== false;
      const summary = await runMonitor({ force: true, notify });
      res.json({
        success: true,
        total: summary.total,
        ok: summary.ok,
        changes: summary.changes?.length || 0,
        errors: summary.errors || [],
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },


  // POST /api/competitors/discover — découverte auto + matching (suggestions)
  discover: async (req, res) => {
    try {
      const brand = (req.body?.brand || "JNR").trim();
      const competitors = req.body?.competitors || ["levapoteur-discount", "cigaretteelec"];
      const results = [];
      for (const comp of competitors) {
        try { results.push(await runDiscovery(comp, brand)); }
        catch (e) { results.push({ competitor: comp, error: e.message }); }
      }
      res.json({ success: true, brand, results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // GET /api/competitors/suggestions?status=pending
  listSuggestions: async (req, res) => {
    try { res.json(await competitorModel.listSuggestions(req.query.status)); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // PUT /api/competitors/suggestions/:id — modifier (SKU/titre/url proposés)
  updateSuggestion: async (req, res) => {
    try {
      const row = await competitorModel.updateSuggestion(req.params.id, req.body);
      if (!row) return res.status(404).json({ error: "Suggestion introuvable" });
      res.json(row);
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // DELETE /api/competitors/suggestions/:id — rejeter/supprimer
  deleteSuggestion: async (req, res) => {
    try { await competitorModel.deleteSuggestion(req.params.id); res.json({ success: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  },

  // POST /api/competitors/suggestions/:id/validate — crée le suivi et marque validé
  validateSuggestion: async (req, res) => {
    try {
      const sug = await competitorModel.getSuggestion(req.params.id);
      if (!sug) return res.status(404).json({ error: "Suggestion introuvable" });
      const sku = (req.body?.matched_sku || sug.matched_sku || "").trim();
      if (!sku) return res.status(400).json({ error: "Aucun SKU Youvape associé — associez un produit avant de valider" });
      const created = await competitorModel.createProduct({
        sku,
        product_name: req.body?.matched_title || sug.matched_title || sug.model_label,
        competitor: sug.competitor,
        url: req.body?.representative_url || sug.representative_url,
        active: true,
      });
      await competitorModel.updateSuggestion(sug.id, { status: "validated", matched_sku: sku });
      res.status(201).json({ success: true, product: created });
    } catch (e) { res.status(500).json({ error: e.message }); }
  },

  // GET /api/competitors/config — expose la config (clé scraping masquée)
  getConfig: async (req, res) => {
    try {
      const [enabled, email, key] = await Promise.all([
        appConfigModel.get('competitor_monitor_enabled'),
        appConfigModel.get('competitor_alert_email'),
        appConfigModel.get('scraperapi_key'),
      ]);
      res.json({
        enabled: enabled?.config_value !== 'false',
        alert_email: email?.config_value || '',
        scraperapi_key_set: !!(key?.config_value?.trim()),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },

  // PUT /api/competitors/config — met à jour email / clé / on-off
  updateConfig: async (req, res) => {
    try {
      const { enabled, alert_email, scraperapi_key } = req.body;
      if (enabled !== undefined) {
        await appConfigModel.upsert('competitor_monitor_enabled', enabled ? 'true' : 'false');
      }
      if (alert_email !== undefined) {
        await appConfigModel.upsert('competitor_alert_email', String(alert_email).trim());
      }
      if (scraperapi_key !== undefined) {
        await appConfigModel.upsert('scraperapi_key', String(scraperapi_key).trim());
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  },
};

module.exports = competitorController;
