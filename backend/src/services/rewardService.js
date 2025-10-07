const axios = require('axios');
const pool = require('../config/database');
const rewardsConfigModel = require('../models/rewardsConfigModel');
const rewardsHistoryModel = require('../models/rewardsHistoryModel');

const rewardService = {
  // Fonction principale pour récompenser les avis éligibles
  processRewards: async () => {
    try {
      console.log('🎁 Démarrage du processus de récompense...');

      // Récupérer la configuration
      const config = await rewardsConfigModel.get();

      if (!config) {
        console.log('⚠️ Aucune configuration de récompense trouvée');
        return { processed: 0, rewarded: 0, errors: 0 };
      }

      if (!config.enabled) {
        console.log('⏸️ Système de récompenses désactivé');
        return { processed: 0, rewarded: 0, errors: 0 };
      }

      // Récupérer les avis éligibles pour récompense
      const query = `
        SELECT * FROM reviews
        WHERE review_status = 1
          AND rewarded = false
          AND customer_email IS NOT NULL
          AND customer_email != ''
        ORDER BY created_at ASC
      `;

      const result = await pool.query(query);
      const eligibleReviews = result.rows;

      console.log(`📊 ${eligibleReviews.length} avis éligibles trouvés`);

      let processed = 0;
      let rewarded = 0;
      let errors = 0;

      for (const review of eligibleReviews) {
        processed++;

        // Double check: Vérifier que l'avis n'a pas déjà été récompensé dans l'historique
        const alreadyRewarded = await rewardsHistoryModel.exists(review.review_id);

        if (alreadyRewarded) {
          console.log(`⚠️ Avis ${review.review_id} déjà dans l'historique, on passe au suivant`);
          continue;
        }

        // Déterminer le nombre de points selon le type
        const points = review.review_type === 'site' ? config.points_site : config.points_product;

        // Appeler l'API WPLoyalty
        const rewardResult = await rewardService.rewardCustomer(
          config,
          review.customer_email,
          points,
          review
        );

        if (rewardResult.success) {
          rewarded++;
          console.log(`✅ Avis ${review.review_id} récompensé avec succès (${points} points)`);
        } else {
          errors++;
          console.log(`❌ Échec de la récompense pour ${review.review_id}: ${rewardResult.error}`);
        }
      }

      console.log(`🎁 Processus terminé: ${processed} traités, ${rewarded} récompensés, ${errors} erreurs`);

      return { processed, rewarded, errors };

    } catch (error) {
      console.error('❌ Erreur dans processRewards:', error);
      return { processed: 0, rewarded: 0, errors: 1, error: error.message };
    }
  },

  // Fonction pour récompenser un client via l'API WPLoyalty
  rewardCustomer: async (config, email, points, review) => {
    try {
      // Construire l'URL de l'API avec les credentials WooCommerce en query params
      const baseUrl = config.woocommerce_url.replace(/\/$/, '');
      const apiUrl = `${baseUrl}/wp-json/wc/v3/wployalty/customers/points/add`;

      // Préparer les options de la requête
      const requestOptions = {
        params: {
          consumer_key: config.consumer_key,
          consumer_secret: config.consumer_secret
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      };

      // Appel API
      const response = await axios.post(
        apiUrl,
        {
          user_email: email,
          points: points
        },
        requestOptions
      );

      // Enregistrer dans l'historique
      await rewardsHistoryModel.create({
        review_id: review.review_id,
        customer_email: email,
        points_awarded: points,
        review_type: review.review_type,
        api_response: response.data,
        api_status: response.status,
        error_message: null,
        rewarded: true
      });

      // Mettre à jour la table reviews
      await pool.query(
        'UPDATE reviews SET rewarded = true, rewarded_at = CURRENT_TIMESTAMP WHERE review_id = $1',
        [review.review_id]
      );

      return {
        success: true,
        status: response.status,
        data: response.data
      };

    } catch (error) {
      // Enregistrer aussi les échecs dans l'historique pour traçabilité
      console.error('Erreur lors de la récompense:', error.message);

      await rewardsHistoryModel.create({
        review_id: review.review_id,
        customer_email: email,
        points_awarded: points,
        review_type: review.review_type,
        api_response: error.response?.data || null,
        api_status: error.response?.status || null,
        error_message: error.message,
        rewarded: false
      });

      return {
        success: false,
        error: error.message,
        details: error.response?.data
      };
    }
  },

  // Tester la connexion à l'API WPLoyalty
  testConnection: async (config) => {
    try {
      const baseUrl = config.woocommerce_url.replace(/\/$/, '');
      const apiUrl = `${baseUrl}/wp-json/wc/v3/wployalty/customers/points/add`;

      // Préparer les options de la requête
      const requestOptions = {
        params: {
          consumer_key: config.consumer_key,
          consumer_secret: config.consumer_secret
        },
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 15000
      };

      // Test avec un email fictif - l'API devrait répondre avec succès
      // (créera un nouveau client si l'email n'existe pas, selon la doc)
      const response = await axios.post(
        apiUrl,
        {
          user_email: 'test-wployalty@example.com',
          points: 1
        },
        requestOptions
      );

      // Si on arrive ici, l'API a répondu avec succès (2xx)
      return {
        success: true,
        status: response.status,
        message: 'Connexion API réussie ! Un point de test a été ajouté au client test-wployalty@example.com',
        data: response.data
      };

    } catch (error) {
      // L'API a renvoyé une erreur
      const status = error.response?.status;
      const errorData = error.response?.data;

      return {
        success: false,
        status: status,
        error: status === 401 ? 'Authentification échouée - Vérifiez vos credentials' :
               status === 404 ? 'Route API introuvable - Vérifiez l\'URL et que WPLoyalty PRO est installé' :
               status === 400 ? 'Paramètres invalides' :
               error.message,
        details: errorData
      };
    }
  },

  // Récompenser manuellement un avis spécifique par son ID
  rewardManual: async (review_id) => {
    try {
      // Récupérer la configuration
      const config = await rewardsConfigModel.get();

      if (!config) {
        return { success: false, error: 'Aucune configuration trouvée' };
      }

      // Note: La vérification config.enabled est volontairement ignorée pour la récompense manuelle
      // L'admin doit pouvoir récompenser manuellement même si le système automatique est désactivé

      // Récupérer l'avis (cherche par review_id ou par id si c'est un nombre)
      const query = 'SELECT * FROM reviews WHERE review_id = $1 OR (id = $2 AND $2 IS NOT NULL)';
      const numericId = !isNaN(review_id) ? parseInt(review_id) : null;
      const result = await pool.query(query, [review_id, numericId]);

      if (result.rows.length === 0) {
        return { success: false, error: 'Avis non trouvé' };
      }

      const review = result.rows[0];

      // Vérifier que l'avis est publié
      if (review.review_status !== 1) {
        return { success: false, error: 'L\'avis n\'est pas publié (review_status doit être 1)' };
      }

      // Vérifier qu'il y a un email
      if (!review.customer_email) {
        return { success: false, error: 'Aucun email associé à cet avis' };
      }

      // Vérifier qu'il n'a pas déjà été récompensé
      if (review.rewarded) {
        return { success: false, error: 'Cet avis a déjà été récompensé' };
      }

      // Double check avec l'historique
      const alreadyRewarded = await rewardsHistoryModel.exists(review.review_id);
      if (alreadyRewarded) {
        return { success: false, error: 'Cet avis est déjà dans l\'historique des récompenses' };
      }

      // Déterminer le nombre de points
      const points = review.review_type === 'site' ? config.points_site : config.points_product;

      // Récompenser
      const rewardResult = await rewardService.rewardCustomer(
        config,
        review.customer_email,
        points,
        review
      );

      if (rewardResult.success) {
        return {
          success: true,
          message: `Avis ${review_id} récompensé avec succès (${points} points attribués à ${review.customer_email})`
        };
      } else {
        return {
          success: false,
          error: `Échec de la récompense: ${rewardResult.error}`
        };
      }

    } catch (error) {
      console.error('Erreur dans rewardManual:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
};

module.exports = rewardService;
