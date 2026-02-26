const cron = require('node-cron');
const appConfigModel = require('../models/appConfigModel');
const reviewsLog = require('../models/reviewsLog');
const reviewsModel = require('../models/reviewsModel');
const axios = require('axios');

let currentCronJob = null;

// Fonction pour récupérer les avis automatiquement
const fetchReviewsAuto = async () => {
  try {
    console.log('🔄 Récupération automatique des avis...');

    // Vérifier si le cron est activé
    const cronEnabledConfig = await appConfigModel.get('cron_enabled');
    if (cronEnabledConfig && cronEnabledConfig.config_value === 'false') {
      console.log('⏸️ Récupération automatique désactivée');
      return;
    }

    // Récupérer la configuration
    const apiKeyConfig = await appConfigModel.get('api_key');
    const reviewTypeConfig = await appConfigModel.get('review_type');
    const limitConfig = await appConfigModel.get('limit');
    const productIdConfig = await appConfigModel.get('product_id');
    const cutoffDateConfig = await appConfigModel.get('cutoff_date');

    if (!apiKeyConfig || !reviewTypeConfig || !limitConfig) {
      console.log('⚠️ Configuration incomplète, récupération automatique annulée');
      return;
    }

    const api_key = apiKeyConfig.config_value;
    const review_type = reviewTypeConfig.config_value;
    const limit = parseInt(limitConfig.config_value);
    const product_id = productIdConfig?.config_value || null;
    const cutoffDate = cutoffDateConfig?.config_value || null;

    // Préparer les paramètres de la requête
    const params = {
      api_key,
      review_type,
      limit,
      page: 1
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
        timeout: 30000
      });

      responseStatus = apiResponse.status;
      responseData = apiResponse.data;

      // Parser et insérer les avis
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
        page: 1,
        response_status: responseStatus,
        response_data: responseData,
        error_message: null
      });

      console.log(`✅ ${insertedCount} nouveaux avis insérés (${responseData?.reviews?.length || 0} récupérés)`);

    } catch (apiError) {
      responseStatus = apiError.response?.status || 500;
      responseData = apiError.response?.data || null;
      errorMessage = apiError.message;

      // Enregistrer le log d'erreur
      await reviewsLog.create({
        api_key_used: api_key,
        review_type,
        limit_value: limit,
        product_id: product_id || null,
        page: 1,
        response_status: responseStatus,
        response_data: responseData,
        error_message: errorMessage
      });

      console.error('❌ Erreur lors de la récupération automatique:', errorMessage);
    }

  } catch (error) {
    console.error('❌ Erreur dans fetchReviewsAuto:', error);
  }
};

// Fonction pour configurer le cron
const setupCron = async () => {
  try {
    // Arrêter le cron existant s'il y en a un
    if (currentCronJob) {
      currentCronJob.stop();
      currentCronJob = null;
    }

    // Récupérer l'intervalle configuré
    const intervalConfig = await appConfigModel.get('interval');

    if (!intervalConfig) {
      console.log('⏸️ Aucun intervalle configuré, cron non démarré');
      return;
    }

    const interval = intervalConfig.config_value;

    // Déterminer l'expression cron basée sur l'intervalle
    let cronExpression = null;

    switch (interval) {
      case 'once_daily':
        cronExpression = '0 0 * * *'; // Tous les jours à 00:00
        break;
      case 'twice_daily':
        cronExpression = '0 0,12 * * *'; // Tous les jours à 00:00 et 12:00
        break;
      case '4_times':
        cronExpression = '0 */6 * * *'; // Toutes les 6 heures
        break;
      case '8_times':
        cronExpression = '0 */3 * * *'; // Toutes les 3 heures
        break;
      case '10_times':
        cronExpression = '24 */2 * * *'; // Toutes les 2h24 (approximatif)
        break;
      case '12_times':
        cronExpression = '0 */2 * * *'; // Toutes les 2 heures
        break;
      default:
        console.log('⚠️ Intervalle non reconnu:', interval);
        return;
    }

    // Créer le nouveau cron job
    currentCronJob = cron.schedule(cronExpression, fetchReviewsAuto, {
      timezone: "Europe/Paris"
    });

    console.log(`✅ Cron configuré avec l'intervalle: ${interval} (${cronExpression})`);

  } catch (error) {
    console.error('❌ Erreur lors de la configuration du cron:', error);
  }
};

// Fonction pour redémarrer le cron (appelée après une mise à jour de config)
const restartCron = async () => {
  console.log('🔄 Redémarrage du cron...');
  await setupCron();
};

// ==================== BMS PURCHASE ORDERS SYNC ====================

const purchaseOrderModel = require('../models/purchaseOrderModel');

let bmsCronJob = null;

const syncBmsOrders = async () => {
  try {
    console.log('🔄 Sync automatique commandes BMS...');
    const result = await purchaseOrderModel.syncFromBMS();
    console.log(`✅ BMS sync: ${result.created} créée(s), ${result.updated} mise(s) à jour, ${result.skipped} ignorée(s)`);
  } catch (error) {
    console.error('❌ Erreur sync BMS auto:', error.message);
  }
};

const setupBmsCron = () => {
  if (bmsCronJob) {
    bmsCronJob.stop();
    bmsCronJob = null;
  }

  // Toutes les 30 min de 9h à 19h, lundi-vendredi
  bmsCronJob = cron.schedule('*/30 9-19 * * 1-5', syncBmsOrders, {
    timezone: 'Europe/Paris'
  });

  console.log('✅ Cron BMS configuré: toutes les 30 min, 9h-19h, lun-ven');
};

module.exports = {
  setupCron,
  restartCron,
  fetchReviewsAuto,
  setupBmsCron
};
