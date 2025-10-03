const axios = require('axios');
const reviewsLog = require('../models/reviewsLog');

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

      try {
        // Appel à l'API externe
        const apiResponse = await axios.get('https://api.guaranteed-reviews.com/private/v3/reviews', {
          params,
          timeout: 30000 // 30 secondes
        });

        responseStatus = apiResponse.status;
        responseData = apiResponse.data;

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
          reviewsCount: responseData?.reviews?.length || 0
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
