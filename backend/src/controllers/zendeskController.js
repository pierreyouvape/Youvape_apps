const zendeskModel = require('../models/zendeskModel');

const zendeskController = {

  // ─── Lire la config (token masqué) ────────────────────────────────────────
  getConfig: async (req, res) => {
    try {
      const cfg = await zendeskModel.getConfig();
      res.json({
        success: true,
        subdomain: cfg.subdomain,
        email: cfg.email,
        hasToken: !!cfg.token, // on ne renvoie jamais le token en clair
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // ─── Enregistrer la config (token réécrit seulement si fourni) ─────────────
  saveConfig: async (req, res) => {
    try {
      const { subdomain, email, token } = req.body;
      await zendeskModel.saveConfig({ subdomain, email, token });
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // ─── Tester la connexion ──────────────────────────────────────────────────
  testConnection: async (req, res) => {
    try {
      // Si un token est fourni dans le body, on l'utilise pour le test (avant save).
      // Sinon on prend la config stockée.
      const stored = await zendeskModel.getConfig();
      const cfg = {
        subdomain: req.body.subdomain || stored.subdomain,
        email: req.body.email || stored.email,
        token: req.body.token || stored.token,
      };
      const user = await zendeskModel.testConnection(cfg);
      res.json({ success: true, user });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },

  // ─── Lister les statuts Zendesk distincts (pour le matching) ──────────────
  previewStatuses: async (req, res) => {
    try {
      const cfg = await zendeskModel.getConfig();
      const statuses = await zendeskModel.listDistinctStatuses(cfg);
      const map = await zendeskModel.getStatusMap();
      res.json({ success: true, statuses, map });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },

  // ─── Lire / enregistrer le mapping des statuts ────────────────────────────
  getStatusMap: async (req, res) => {
    try {
      const map = await zendeskModel.getStatusMap();
      res.json({ success: true, map });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  saveStatusMap: async (req, res) => {
    try {
      const { entries } = req.body; // [{ zendesk_value, app_status }]
      if (!Array.isArray(entries)) {
        return res.status(400).json({ success: false, error: 'entries[] requis' });
      }
      await zendeskModel.saveStatusMap(entries);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // ─── Lister les champs custom Zendesk (pour le mapping) ───────────────────
  previewFields: async (req, res) => {
    try {
      const cfg = await zendeskModel.getConfig();
      const fields = await zendeskModel.listFields(cfg);
      const map = await zendeskModel.getFieldMap();
      res.json({ success: true, fields, map, nativeTargets: zendeskModel.NATIVE_TARGETS });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },

  // ─── Lire / enregistrer le mapping des champs ─────────────────────────────
  getFieldMap: async (req, res) => {
    try {
      const map = await zendeskModel.getFieldMap();
      res.json({ success: true, map, nativeTargets: zendeskModel.NATIVE_TARGETS });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  saveFieldMap: async (req, res) => {
    try {
      const { entries } = req.body; // [{ zendesk_field, zendesk_title, target_type, target }]
      if (!Array.isArray(entries)) {
        return res.status(400).json({ success: false, error: 'entries[] requis' });
      }
      await zendeskModel.saveFieldMap(entries);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  },

  // ─── Import en streaming (Server-Sent Events) ─────────────────────────────
  // Le front ouvre une connexion et reçoit des événements `progress` puis `done`.
  importStream: async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // désactive le buffering nginx pour ce flux
    res.flushHeaders?.();

    const send = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush?.();
    };

    // Heartbeat : un commentaire SSE (":") toutes les 15s pour que la connexion
    // ne soit jamais idle (sinon nginx/Cloudflare coupe au bout de leur timeout).
    const heartbeat = setInterval(() => {
      res.write(': ping\n\n');
      res.flush?.();
    }, 15000);

    // Si le client se déconnecte, on arrête le heartbeat et on signale l'abandon
    // pour que l'import en cours s'arrête proprement (pas de process orphelin).
    let aborted = false;
    req.on('close', () => {
      aborted = true;
      clearInterval(heartbeat);
    });

    // Throttle des events progress (évite de saturer le flux sur des milliers de tickets)
    let lastSent = 0;
    const onProgress = (p) => {
      if (aborted) return;
      const now = Date.now();
      if (now - lastSent > 250 || p.done === p.total) {
        lastSent = now;
        send('progress', p);
      }
    };

    try {
      const cfg = await zendeskModel.getConfig();
      if (!cfg.subdomain || !cfg.email || !cfg.token) {
        send('error', { error: 'Connexion Zendesk non configurée' });
        return res.end();
      }
      const recap = await zendeskModel.importAll(cfg, onProgress);
      if (!aborted) send('done', recap);
    } catch (err) {
      if (!aborted) send('error', { error: err.message });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  },
};

module.exports = zendeskController;
