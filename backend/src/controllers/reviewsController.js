const axios = require('axios');
const reviewsLog = require('../models/reviewsLog');
const reviewsModel = require('../models/reviewsModel');
const appConfigModel = require('../models/appConfigModel');

const reviewsController = {
  // Récupérer les avis depuis l'API Société des Avis Garantis
  fetchReviews: async (req, res) => {
    try {
      const { api_key, review_type, limit, product_id, page } = req.body;

      // Validation
      if (!api_key || !review_type || !limit) {
        return res.status(400).json({ error: 'api_key, review_type et limit sont requis' });
      }

      if (!['site', 'product', 'both'].includes(review_type)) {
        return res.status(400).json({ error: 'review_type doit être: site, product ou both' });
      }

      if (limit > 1000 || limit < 1) {
        return res.status(400).json({ error: 'limit doit être entre 1 et 1000' });
      }

      // Récupérer la date de coupure si configurée
      const cutoffDateConfig = await appConfigModel.get('cutoff_date');
      const cutoffDate = cutoffDateConfig?.config_value || null;

      // Préparer les paramètres de la requête
      const params = {
        api_key,
        review_type,
        limit,
        page: page || 1
      };

      if (product_id) {
        params.product_id = product_id;
      }

      let responseStatus = null;
      let responseData = null;
      let errorMessage = null;
      let insertedCount = 0;

      try {
        // Appel à l'API externe
        const apiResponse = await axios.get('https://api.guaranteed-reviews.com/private/v3/reviews', {
          params,
          timeout: 30000 // 30 secondes
        });

        responseStatus = apiResponse.status;
        responseData = apiResponse.data;

        // Parser et insérer les avis dans la base de données
        if (responseData && responseData.reviews && Array.isArray(responseData.reviews)) {
          for (const review of responseData.reviews) {
            try {
              // Convertir la date au format ISO pour PostgreSQL
              let reviewDate = null;
              if (review.date_time) {
                // Format reçu: "2025-10-01 11:26:51"
                reviewDate = review.date_time.replace(' ', 'T');
              }

              // Filtrer par date de coupure si configurée
              if (cutoffDate && reviewDate) {
                const reviewTimestamp = new Date(reviewDate).getTime();
                const cutoffTimestamp = new Date(cutoffDate).getTime();

                if (reviewTimestamp < cutoffTimestamp) {
                  console.log(`⏭️ Avis ${review.id} ignoré (antérieur à ${cutoffDate})`);
                  continue; // Passer à l'avis suivant
                }
              }

              // Déterminer le type d'avis
              const isProductReview = review.product && review.product !== 'no';
              const reviewType = isProductReview ? 'product' : 'site';

              // Construire le nom complet du client
              const firstName = review.reviewer_name || '';
              const lastName = review.reviewer_lastname || '';
              const fullName = `${firstName} ${lastName}`.trim() || null;

              const inserted = await reviewsModel.create({
                review_id: review.id || `${Date.now()}-${Math.random()}`,
                review_type: reviewType,
                rating: parseInt(review.review_rating) || 0,
                comment: review.review_text || null,
                customer_name: fullName,
                customer_email: review.reviewer_email || null,
                product_id: isProductReview ? review.product : null,
                review_date: reviewDate,
                review_status: parseInt(review.review_status) || 0,
                order_id: review.order || null
              });
              if (inserted) {
                insertedCount++;
              }
            } catch (insertError) {
              console.log(`Erreur lors de l'insertion de l'avis ${review.id}:`, insertError.message);
            }
          }
        }

        // Enregistrer le log
        await reviewsLog.create({
          api_key_used: api_key,
          review_type,
          limit_value: limit,
          product_id: product_id || null,
          page: page || 1,
          response_status: responseStatus,
          response_data: responseData,
          error_message: null
        });

        // Retourner les avis
        return res.json({
          success: true,
          status: responseStatus,
          data: responseData,
          reviewsCount: responseData?.reviews?.length || 0,
          insertedCount: insertedCount
        });

      } catch (apiError) {
        // En cas d'erreur de l'API externe
        responseStatus = apiError.response?.status || 500;
        responseData = apiError.response?.data || null;
        errorMessage = apiError.message;

        // Enregistrer le log d'erreur
        await reviewsLog.create({
          api_key_used: api_key,
          review_type,
          limit_value: limit,
          product_id: product_id || null,
          page: page || 1,
          response_status: responseStatus,
          response_data: responseData,
          error_message: errorMessage
        });

        return res.status(responseStatus).json({
          success: false,
          error: 'Erreur lors de l\'appel à l\'API externe',
          message: errorMessage,
          details: responseData
        });
      }

    } catch (error) {
      console.error('Erreur lors de la récupération des avis:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Sauvegarder la configuration
  saveConfig: async (req, res) => {
    try {
      const { api_key, review_type, limit, product_id, interval, cutoff_date } = req.body;

      // Validation
      if (!api_key || !review_type || !limit || !interval) {
        return res.status(400).json({ error: 'Tous les champs sont requis (sauf product_id et cutoff_date)' });
      }

      // Sauvegarder chaque paramètre
      await appConfigModel.upsert('api_key', api_key);
      await appConfigModel.upsert('review_type', review_type);
      await appConfigModel.upsert('limit', limit.toString());
      await appConfigModel.upsert('product_id', product_id || '');
      await appConfigModel.upsert('interval', interval);
      await appConfigModel.upsert('cutoff_date', cutoff_date || '');

      res.json({
        success: true,
        message: 'Configuration sauvegardée avec succès'
      });

    } catch (error) {
      console.error('Erreur lors de la sauvegarde de la configuration:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer la configuration
  getConfig: async (req, res) => {
    try {
      const configs = await appConfigModel.getAll();

      // Convertir en objet clé-valeur
      const configObject = {};
      configs.forEach(config => {
        configObject[config.config_key] = config.config_value;
      });

      // Ajouter cron_enabled par défaut si absent
      if (!configObject.cron_enabled) {
        configObject.cron_enabled = 'true';
      }

      res.json({
        success: true,
        config: configObject
      });

    } catch (error) {
      console.error('Erreur lors de la récupération de la configuration:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Activer/désactiver le cron automatique
  toggleCron: async (req, res) => {
    try {
      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'Le champ enabled doit être un booléen' });
      }

      await appConfigModel.upsert('cron_enabled', enabled.toString());

      res.json({
        success: true,
        message: enabled ? 'Récupération automatique activée' : 'Récupération automatique désactivée',
        cron_enabled: enabled
      });

    } catch (error) {
      console.error('Erreur lors du changement de statut du cron:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer les avis stockés
  getStoredReviews: async (req, res) => {
    try {
      const reviews = await reviewsModel.getAll();

      res.json({
        success: true,
        count: reviews.length,
        reviews
      });

    } catch (error) {
      console.error('Erreur lors de la récupération des avis stockés:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Mettre à jour le statut récompensé
  updateRewardStatus: async (req, res) => {
    try {
      const { id } = req.params;
      const { rewarded } = req.body;

      if (typeof rewarded !== 'boolean') {
        return res.status(400).json({ error: 'Le champ rewarded doit être un booléen' });
      }

      const updated = await reviewsModel.updateRewardStatus(id, rewarded);

      if (!updated) {
        return res.status(404).json({ error: 'Avis non trouvé' });
      }

      res.json({
        success: true,
        message: 'Statut mis à jour',
        review: updated
      });

    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Vider tous les avis
  deleteAllReviews: async (req, res) => {
    try {
      await reviewsModel.deleteAll();

      res.json({
        success: true,
        message: 'Tous les avis ont été supprimés'
      });

    } catch (error) {
      console.error('Erreur lors de la suppression des avis:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Créer un avis manuellement (pour les tests)
  createManualReview: async (req, res) => {
    try {
      const { review_type, rating, comment, customer_name, customer_email, product_id, review_status, order_id } = req.body;

      // Validation
      if (!review_type || !rating || !customer_name) {
        return res.status(400).json({ error: 'review_type, rating et customer_name sont requis' });
      }

      // Générer un ID unique
      const review_id = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const inserted = await reviewsModel.create({
        review_id,
        review_type,
        rating: parseInt(rating),
        comment: comment || null,
        customer_name,
        customer_email: customer_email || null,
        product_id: product_id || null,
        review_date: new Date().toISOString(),
        review_status: parseInt(review_status) || 0,
        order_id: order_id || null
      });

      res.json({
        success: true,
        message: 'Avis créé avec succès',
        review: inserted
      });

    } catch (error) {
      console.error('Erreur lors de la création manuelle de l\'avis:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer tous les logs
  getLogs: async (req, res) => {
    try {
      const { date } = req.query;

      const logs = await reviewsLog.getAll(date || null);

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

      const logs = await reviewsLog.getAllForExport(date || null);

      // Créer le contenu CSV
      const headers = ['ID', 'API Key', 'Type', 'Limit', 'Product ID', 'Page', 'Status', 'Error', 'Date'];
      const csvRows = [headers.join(',')];

      logs.forEach(log => {
        const row = [
          log.id,
          `"${log.api_key_used}"`,
          log.review_type,
          log.limit_value,
          log.product_id || '',
          log.page,
          log.response_status || '',
          log.error_message ? `"${log.error_message.replace(/"/g, '""')}"` : '',
          new Date(log.created_at).toISOString()
        ];
        csvRows.push(row.join(','));
      });

      const csv = csvRows.join('\n');

      // Définir les en-têtes pour le téléchargement
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=reviews_logs_${date || 'all'}.csv`);

      res.send(csv);

    } catch (error) {
      console.error('Erreur lors de l\'export des logs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = reviewsController;
