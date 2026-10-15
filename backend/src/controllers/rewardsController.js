const rewardsConfigModel = require('../models/rewardsConfigModel');
const rewardsHistoryModel = require('../models/rewardsHistoryModel');
const rewardService = require('../services/rewardService');

const rewardsController = {
  // Sauvegarder la configuration
  saveConfig: async (req, res) => {
    try {
      const { woocommerce_url, consumer_key, consumer_secret, points_site, points_product, enabled } = req.body;

      // Validation
      if (!woocommerce_url || !consumer_key || !consumer_secret) {
        return res.status(400).json({ error: 'URL, Consumer Key et Consumer Secret sont requis' });
      }

      if (points_site === undefined || points_product === undefined) {
        return res.status(400).json({ error: 'Les points pour site et produit sont requis' });
      }

      const config = await rewardsConfigModel.upsert({
        woocommerce_url,
        consumer_key,
        consumer_secret,
        points_site: parseInt(points_site),
        points_product: parseInt(points_product),
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
      const config = await rewardsConfigModel.get();

      res.json({
        success: true,
        config: config || null
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de la configuration:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Tester la connexion à l'API WPLoyalty
  testConnection: async (req, res) => {
    try {
      const config = await rewardsConfigModel.get();

      if (!config) {
        return res.status(400).json({ error: 'Aucune configuration trouvée. Veuillez d\'abord sauvegarder la configuration.' });
      }

      const result = await rewardService.testConnection(config);

      if (result.success) {
        res.json({
          success: true,
          message: 'Connexion API réussie',
          status: result.status,
          data: result.data
        });
      } else {
        res.status(400).json({
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

  // Lancer manuellement le processus de récompense
  processRewards: async (req, res) => {
    try {
      const result = await rewardService.processRewards();

      res.json({
        success: true,
        message: 'Processus de récompense terminé',
        stats: result
      });

    } catch (error) {
      console.error('Erreur lors du processus de récompense:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer l'historique des récompenses
  getHistory: async (req, res) => {
    try {
      const { date } = req.query;

      let history;
      if (date) {
        history = await rewardsHistoryModel.getByDate(date);
      } else {
        history = await rewardsHistoryModel.getAll();
      }

      const stats = await rewardsHistoryModel.getStats();

      res.json({
        success: true,
        count: history.length,
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
        history = await rewardsHistoryModel.getByDate(date);
      } else {
        history = await rewardsHistoryModel.getAll();
      }

      // Créer le contenu CSV
      const headers = ['ID', 'Review ID', 'Email', 'Points', 'Type', 'Statut API', 'Erreur', 'Date'];
      const csvRows = [headers.join(',')];

      history.forEach(entry => {
        const row = [
          entry.id,
          entry.review_id,
          entry.customer_email,
          entry.points_awarded,
          entry.review_type,
          entry.api_status || '',
          entry.error_message ? `"${entry.error_message.replace(/"/g, '""')}"` : '',
          new Date(entry.created_at).toISOString()
        ];
        csvRows.push(row.join(','));
      });

      const csv = csvRows.join('\n');

      // Définir les en-têtes pour le téléchargement
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=rewards_history_${date || 'all'}.csv`);

      res.send(csv);

    } catch (error) {
      console.error('Erreur lors de l\'export de l\'historique:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Activer/Désactiver le système
  toggleEnabled: async (req, res) => {
    try {
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Le champ enabled doit être un booléen' });
      }

      const config = await rewardsConfigModel.toggleEnabled(enabled);

      res.json({
        success: true,
        message: enabled ? 'Système de récompenses activé' : 'Système de récompenses désactivé',
        config
      });

    } catch (error) {
      console.error('Erreur lors du changement de statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récompenser manuellement un avis spécifique
  rewardManual: async (req, res) => {
    try {
      const { review_id } = req.body;

      if (!review_id) {
        return res.status(400).json({ error: 'L\'ID de l\'avis est requis' });
      }

      const result = await rewardService.rewardManual(review_id);

      if (result.success) {
        res.json({
          success: true,
          message: result.message
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error
        });
      }

    } catch (error) {
      console.error('Erreur lors de la récompense manuelle:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = rewardsController;
