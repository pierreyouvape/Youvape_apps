const emailConfigModel = require('../models/emailConfigModel');
const emailSentTrackingModel = require('../models/emailSentTrackingModel');
const emailService = require('../services/emailService');

const emailController = {
  // Sauvegarder la configuration
  saveConfig: async (req, res) => {
    try {
      const { probance_url, probance_token, campaign_external_id, enabled } = req.body;

      // Validation
      if (!probance_url || !probance_token || !campaign_external_id) {
        return res.status(400).json({
          error: 'probance_url, probance_token et campaign_external_id sont requis'
        });
      }

      const config = await emailConfigModel.upsert({
        probance_url,
        probance_token,
        campaign_external_id,
        enabled: enabled !== undefined ? enabled : true
      });

      res.json({
        success: true,
        message: 'Configuration sauvegardée avec succès',
        config
      });

    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la configuration:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer la configuration
  getConfig: async (req, res) => {
    try {
      const config = await emailConfigModel.get();

      res.json({
        success: true,
        config: config || {
          probance_url: 'https://www.probancemail.com/rest/v2/send/',
          probance_token: '',
          campaign_external_id: '',
          enabled: true
        }
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de la configuration:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Activer/désactiver le système
  toggleEnabled: async (req, res) => {
    try {
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Le champ enabled doit être un booléen' });
      }

      const config = await emailConfigModel.toggleEnabled(enabled);

      res.json({
        success: true,
        message: enabled ? 'Système d\'emails activé' : 'Système d\'emails désactivé',
        config
      });

    } catch (error) {
      console.error('Erreur lors du changement de statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Tester la connexion à l'API Probance
  testConnection: async (req, res) => {
    try {
      const { test_email } = req.body;

      if (!test_email) {
        return res.status(400).json({ error: 'L\'adresse email de test est requise' });
      }

      // Récupérer la configuration
      const config = await emailConfigModel.get();

      if (!config) {
        return res.status(400).json({ error: 'Aucune configuration trouvée. Veuillez d\'abord configurer l\'API Probance.' });
      }

      // Tester la connexion
      const result = await emailService.testConnection(config, test_email);

      if (result.success) {
        res.json({
          success: true,
          message: result.message,
          status: result.status
        });
      } else {
        res.status(result.status || 500).json({
          success: false,
          error: result.error,
          details: result.details
        });
      }

    } catch (error) {
      console.error('Erreur lors du test de connexion:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Lancer manuellement le processus d'envoi d'emails
  processEmails: async (req, res) => {
    try {
      const stats = await emailService.processEmails();

      res.json({
        success: true,
        message: 'Processus d\'envoi d\'emails terminé',
        stats
      });

    } catch (error) {
      console.error('Erreur lors du processus d\'envoi:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer l'historique des emails envoyés
  getHistory: async (req, res) => {
    try {
      const { date } = req.query;

      let history;
      if (date) {
        history = await emailSentTrackingModel.getByDate(date);
      } else {
        history = await emailSentTrackingModel.getAll();
      }

      const stats = await emailSentTrackingModel.getStats();

      res.json({
        success: true,
        history,
        stats
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de l\'historique:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Exporter l'historique en CSV
  exportHistory: async (req, res) => {
    try {
      const { date } = req.query;

      let history;
      if (date) {
        history = await emailSentTrackingModel.getByDate(date);
      } else {
        history = await emailSentTrackingModel.getAll();
      }

      // Créer le contenu CSV
      const headers = ['ID', 'Order ID', 'Email', 'Reviews Count', 'Date'];
      const csvRows = [headers.join(',')];

      history.forEach(entry => {
        const row = [
          entry.id,
          `"${entry.order_id}"`,
          `"${entry.customer_email}"`,
          entry.reviews_count,
          new Date(entry.sent_at).toISOString()
        ];
        csvRows.push(row.join(','));
      });

      const csv = csvRows.join('\n');

      // Définir les en-têtes pour le téléchargement
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=email_history_${date || 'all'}.csv`);

      res.send(csv);

    } catch (error) {
      console.error('Erreur lors de l\'export de l\'historique:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer les logs (même chose que l'historique pour cette app)
  getLogs: async (req, res) => {
    try {
      const { date } = req.query;

      let logs;
      if (date) {
        logs = await emailSentTrackingModel.getByDate(date);
      } else {
        logs = await emailSentTrackingModel.getAll();
      }

      res.json({
        success: true,
        count: logs.length,
        logs
      });

    } catch (error) {
      console.error('Erreur lors de la récupération des logs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Exporter les logs en CSV
  exportLogs: async (req, res) => {
    try {
      const { date } = req.query;

      let logs;
      if (date) {
        logs = await emailSentTrackingModel.getByDate(date);
      } else {
        logs = await emailSentTrackingModel.getAll();
      }

      // Créer le contenu CSV
      const headers = ['ID', 'Order ID', 'Email', 'Reviews Count', 'Sent At'];
      const csvRows = [headers.join(',')];

      logs.forEach(log => {
        const row = [
          log.id,
          `"${log.order_id}"`,
          `"${log.customer_email}"`,
          log.reviews_count,
          new Date(log.sent_at).toISOString()
        ];
        csvRows.push(row.join(','));
      });

      const csv = csvRows.join('\n');

      // Définir les en-têtes pour le téléchargement
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=email_logs_${date || 'all'}.csv`);

      res.send(csv);

    } catch (error) {
      console.error('Erreur lors de l\'export des logs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = emailController;
