const cron = require('node-cron');
const appConfigModel = require('../models/appConfigModel');
const reviewsLog = require('../models/reviewsLog');
const reviewsModel = require('../models/reviewsModel');
const axios = require('axios');
const { sendAlert } = require('./alertService');

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
      sendAlert(
        `Cron Reviews: echec API avis`,
        `La recuperation automatique des avis a echoue.\n\nStatus: ${responseStatus}\nErreur: ${errorMessage}`
      );
    }

  } catch (error) {
    console.error('❌ Erreur dans fetchReviewsAuto:', error);
    sendAlert(
      `Cron Reviews: erreur fatale`,
      `Erreur inattendue dans fetchReviewsAuto.\n\nErreur: ${error.message}`
    );
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
    sendAlert(
      `Cron BMS: echec sync commandes`,
      `La synchronisation automatique des commandes BMS a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupBmsCron = () => {
  if (bmsCronJob) {
    bmsCronJob.stop();
    bmsCronJob = null;
  }

  // Toutes les 30 min de 9h30 à 19h30, lundi-vendredi (9h00 evite car BMS indisponible)
  bmsCronJob = cron.schedule('30 9-19 * * 1-5', syncBmsOrders, {
    timezone: 'Europe/Paris'
  });

  console.log('✅ Cron BMS configuré: toutes les heures à :30, 9h30-19h30, lun-ven');
};

// ==================== COMPUTED COST (PMP FIFO) ====================

const computedCostModel = require('../models/computedCostModel');

let computedCostCronJob = null;

const recalculateComputedCost = async () => {
  try {
    console.log('Recalcul PMP FIFO (computed_cost)...');
    const result = await computedCostModel.recalculateAll();
    console.log(`PMP FIFO: ${result.updatedCount} produits mis a jour en ${result.elapsed}ms`);
  } catch (error) {
    console.error('Erreur recalcul PMP FIFO:', error.message);
    sendAlert(
      `Cron PMP FIFO: echec recalcul`,
      `Le recalcul automatique du PMP FIFO (computed_cost) a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupComputedCostCron = () => {
  if (computedCostCronJob) {
    computedCostCronJob.stop();
    computedCostCronJob = null;
  }

  // Toutes les 30 min (decale de 5 min apres BMS sync), 9h-19h, lun-ven
  computedCostCronJob = cron.schedule('5,35 9-19 * * 1-5', recalculateComputedCost, {
    timezone: 'Europe/Paris'
  });

  console.log('Cron PMP FIFO configure: toutes les 30 min (offset 5min), 9h-19h, lun-ven');
};

// ==================== STOCK RESYNC (ONE-SHOT) ====================

const { runStockResync } = require('./stockResyncService');

let stockResyncCronJob = null;

/**
 * Verifie toutes les minutes si c'est l'heure de lancer le re-sync stocks.
 * Se desactive automatiquement apres execution.
 */
const checkStockResync = async () => {
  try {
    const config = await appConfigModel.get('stock_resync_scheduled_at');
    if (!config || !config.config_value) return;

    const scheduledAt = new Date(config.config_value);
    const now = new Date();

    if (now >= scheduledAt) {
      console.log('[StockResync] Heure atteinte, lancement du re-sync...');

      // Arreter le check pour ne pas relancer
      if (stockResyncCronJob) {
        stockResyncCronJob.stop();
        stockResyncCronJob = null;
      }

      // Lancer en async (ne pas bloquer le cron)
      runStockResync().catch(err => {
        console.error('[StockResync] Erreur non catchee:', err.message);
      });
    }
  } catch (error) {
    console.error('[StockResync] Erreur check:', error.message);
  }
};

const setupStockResyncCron = () => {
  if (stockResyncCronJob) {
    stockResyncCronJob.stop();
    stockResyncCronJob = null;
  }

  // Check toutes les minutes
  stockResyncCronJob = cron.schedule('* * * * *', checkStockResync, {
    timezone: 'Europe/Paris'
  });

  console.log('Cron StockResync configure: check toutes les minutes');
};

// ==================== BMS BARCODES SYNC ====================

const productsController = require('../controllers/productsController');

let bmsBarcodeCronJob = null;

const syncBmsBarcodes = async () => {
  try {
    const result = await productsController.syncBarcodesFromBMS();
    if (result.synced > 0) {
      console.log(`BMS Barcodes: ${result.synced}/${result.total} codes-barres importes`);
    }
  } catch (error) {
    console.error('Erreur sync BMS barcodes:', error.message);
    sendAlert(
      `Cron BMS Barcodes: echec sync`,
      `La synchronisation automatique des codes-barres BMS a echoue.\n\nErreur: ${error.message}`
    );
  }
};

let bmsShelfLocationCronJob = null;

const syncBmsShelfLocations = async () => {
  try {
    const result = await productsController.syncShelfLocationsFromBMS();
    console.log(`BMS Emplacements: ${result.withLocation}/${result.synced} produits avec emplacement`);
  } catch (error) {
    console.error('Erreur sync BMS emplacements:', error.message);
    sendAlert(
      `Cron BMS Emplacements: echec sync`,
      `La synchronisation des emplacements de rangement a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupBmsShelfLocationCron = () => {
  if (bmsShelfLocationCronJob) {
    bmsShelfLocationCronJob.stop();
    bmsShelfLocationCronJob = null;
  }

  // Une fois par nuit : ~5 600 appels BMS (un par SKU), soit ~90 s. Les emplacements
  // bougent rarement, un rafraichissement quotidien suffit largement.
  bmsShelfLocationCronJob = cron.schedule('20 4 * * *', syncBmsShelfLocations, {
    timezone: 'Europe/Paris'
  });

  console.log('Cron BMS emplacements configure: tous les jours a 4h20 (Europe/Paris)');
};

const setupBmsBarcodeCron = () => {
  if (bmsBarcodeCronJob) {
    bmsBarcodeCronJob.stop();
    bmsBarcodeCronJob = null;
  }

  // Toutes les heures a :15, 9h-19h, lun-ven
  bmsBarcodeCronJob = cron.schedule('15 9-19 * * 1-5', syncBmsBarcodes, {
    timezone: 'Europe/Paris'
  });

  console.log('Cron BMS Barcodes configure: toutes les heures a :15, 9h-19h, lun-ven');
};

// ─── Automatismes SAV ──────────────────────────────────────────────────────
// Évalue les règles de changement de statut basées sur des conditions temporelles
// (statut depuis X, sans réponse client depuis X, etc.)

const { runAll: runAllAutomations } = require('./automationRunner');

let savAutomationsCronJob = null;

const runSavAutomations = async () => {
  try {
    const summary = await runAllAutomations();
    const affected = summary.reduce((acc, s) => acc + (s.count || 0), 0);
    if (affected > 0) {
      console.log(`Cron SAV Automations: ${affected} ticket(s) modifie(s) sur ${summary.length} regle(s)`);
    }
  } catch (error) {
    console.error('Erreur cron SAV automations:', error.message);
  }
};

const setupSavAutomationsCron = () => {
  if (savAutomationsCronJob) {
    savAutomationsCronJob.stop();
    savAutomationsCronJob = null;
  }
  // Toutes les heures pile, 24/7 (les delais sont en heures/jours)
  savAutomationsCronJob = cron.schedule('0 * * * *', runSavAutomations, {
    timezone: 'Europe/Paris'
  });
  console.log('Cron SAV Automations configure: toutes les heures (24/7, Europe/Paris)');
};

// ==================== PRODUCT DB SYNC (WC/ATUM) ====================

const { runProductDbSync } = require('./productDbSyncService');

let productDbSyncCronJob = null;

const runProductDbSyncJob = async () => {
  try {
    const result = await runProductDbSync();
    console.log(`[ProductDbSync] ${result.totalRows} produits verifies, ${result.statusUpdated} statuts/stocks mis a jour, ${result.variableUpdated} parents variables, ${result.ghosts.length} fiches fantomes neutralisees, ${result.errors.length} erreurs, en ${result.elapsed}ms`);
    if (result.ghosts.length > 0) {
      const units = result.ghosts.reduce((s, g) => s + Number(g.old_stock || 0), 0);
      sendAlert(
        `Product DB Sync: ${result.ghosts.length} fiche(s) fantome(s) neutralisee(s)`,
        `Ces produits avaient du stock en base alors qu'ils n'existent plus dans WooCommerce.\n` +
        `Leur stock a ete remis a 0 (outofstock, hors catalogue). La ligne est conservee ` +
        `(elle peut etre referencee par des commandes d'achat).\n\n` +
        `${result.ghosts.length} fiche(s), ${units} unite(s) fantomes:\n\n` +
        result.ghosts.map(g => `- [${g.sku || 'sans SKU'}] ${g.post_title} (${g.product_type}, ${g.post_status}) — ${g.old_stock} u. — wp_id ${g.wp_product_id}`).join('\n')
      );
    }
    if (result.errors.length > 0) {
      sendAlert(
        `Cron Product DB Sync: ${result.errors.length} erreur(s)`,
        `La resynchronisation nocturne produits a rencontre des erreurs sur certains produits:\n\n` +
        result.errors.map(e => `- wp_product_id ${e.wp_product_id}: ${e.error}`).join('\n')
      );
    }
  } catch (error) {
    console.error('Erreur cron Product DB Sync:', error.message);
    sendAlert(
      `Cron Product DB Sync: echec`,
      `La resynchronisation nocturne produits (statut/stock/suivi ATUM) a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupProductDbSyncCron = () => {
  if (productDbSyncCronJob) {
    productDbSyncCronJob.stop();
    productDbSyncCronJob = null;
  }
  // Tous les jours a 3h du matin
  productDbSyncCronJob = cron.schedule('0 3 * * *', runProductDbSyncJob, {
    timezone: 'Europe/Paris'
  });
  console.log('Cron Product DB Sync configure: tous les jours a 3h (Europe/Paris)');
};

// ==================== BMS ORDER TAG RETRY (SAV) ====================
// Rattrapage des tickets SAV dont le tag BMS « Ticket » n'a pas pu être posé
// (commande pas encore importée dans BMS au moment où le client a écrit).

const { retryPendingTags } = require('./bmsOrderTagService');

let bmsTagRetryCronJob = null;

const runBmsTagRetry = async () => {
  try {
    await retryPendingTags();
  } catch (error) {
    console.error('Erreur cron BMS tag retry:', error.message);
  }
};

const setupBmsTagRetryCron = () => {
  if (bmsTagRetryCronJob) {
    bmsTagRetryCronJob.stop();
    bmsTagRetryCronJob = null;
  }
  // Toutes les 15 min, 9h-19h, lun-ven (reactivite : tag pose des que BMS importe la commande)
  bmsTagRetryCronJob = cron.schedule('*/15 9-19 * * 1-5', runBmsTagRetry, {
    timezone: 'Europe/Paris'
  });
  console.log('Cron BMS tag retry configure: toutes les 15 min, 9h-19h, lun-ven');
};

// ─── Cron envoi automatique de rapports par email ───────────────────────────
let reportEmailDailyJob = null;
let reportEmailWeeklyJob = null;
let reportEmailMonthlyJob = null;

const runReportEmail = async (freq) => {
  try {
    const reportEmailService = require('./reportEmailService');
    await reportEmailService.sendReport(freq);
  } catch (error) {
    console.error(`Erreur cron rapport email (${freq}):`, error.message);
  }
};

const setupReportEmailCron = () => {
  [reportEmailDailyJob, reportEmailWeeklyJob, reportEmailMonthlyJob].forEach((j) => { if (j) j.stop(); });

  // Journalier : tous les jours à 6h (couvre la journée d'hier)
  reportEmailDailyJob = cron.schedule('0 6 * * *', () => runReportEmail('daily'), { timezone: 'Europe/Paris' });
  // Hebdomadaire : lundi 6h (couvre la semaine écoulée)
  reportEmailWeeklyJob = cron.schedule('0 6 * * 1', () => runReportEmail('weekly'), { timezone: 'Europe/Paris' });
  // Mensuel : 1er du mois 6h (couvre le mois précédent)
  reportEmailMonthlyJob = cron.schedule('0 6 1 * *', () => runReportEmail('monthly'), { timezone: 'Europe/Paris' });

  console.log('Cron rapports email configure: journalier 6h, hebdo lundi 6h, mensuel 1er 6h (Europe/Paris)');
};

// ==================== SNAPSHOT VALEUR DE STOCK (achat HT) ====================

const stockValuationModel = require('../models/stockValuationModel');

let stockValuationSnapshotJob = null;

const runStockValuationSnapshot = async () => {
  try {
    const point = await stockValuationModel.snapshotToday();
    console.log(`Snapshot valeur de stock: ${point.total_value_ht} EUR HT (${point.products_count} produits, ${point.total_units} unites)`);

    // Garde-fou : le rapport doit toujours donner le meme chiffre que le catalogue.
    // Toute divergence signale une regression (perimetre, units_per_qty, statuts de vente).
    const check = await stockValuationModel.checkAlignmentWithCatalog();
    if (!check.aligned) {
      console.error(`Valeur de stock desalignee du catalogue: rapport ${check.report} vs catalogue ${check.catalog} (ecart ${check.delta})`);
      sendAlert(
        'Valeur de stock: rapport desaligne du catalogue',
        `Le rapport /stats/reports et le catalogue ne donnent plus la meme valeur de stock HT.\n\n` +
        `Rapport   : ${check.report} EUR HT\n` +
        `Catalogue : ${check.catalog} EUR HT\n` +
        `Ecart     : ${check.delta} EUR\n\n` +
        `A verifier dans stockValuationModel : perimetre (STOCK_VALUE_SCOPE), units_per_qty sur les lots, ` +
        `liste blanche des 6 statuts payes.`
      );
    }
  } catch (error) {
    console.error('Erreur snapshot valeur de stock:', error.message);
    sendAlert(
      'Cron snapshot valeur de stock: echec',
      `L'enregistrement quotidien de la valeur de stock a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupStockValuationSnapshotCron = () => {
  if (stockValuationSnapshotJob) {
    stockValuationSnapshotJob.stop();
    stockValuationSnapshotJob = null;
  }
  // Tous les jours a 23h55 (Europe/Paris) : capture la valeur de fin de journee.
  stockValuationSnapshotJob = cron.schedule('55 23 * * *', runStockValuationSnapshot, {
    timezone: 'Europe/Paris'
  });
  console.log('Cron snapshot valeur de stock configure: tous les jours a 23h55 (Europe/Paris)');
};

// ==================== RAPPORT HEBDO STOCK NON PUBLIÉ ====================

const { sendWeeklyDraftStockReport } = require('./stockDraftReportService');

let draftStockReportJob = null;

const runDraftStockReport = async () => {
  try {
    await sendWeeklyDraftStockReport();
  } catch (error) {
    console.error('Erreur rapport hebdo stock non publie:', error.message);
    sendAlert(
      'Cron rapport stock non publie: echec',
      `L'envoi du rapport hebdomadaire des produits en stock non publies a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupDraftStockReportCron = () => {
  if (draftStockReportJob) {
    draftStockReportJob.stop();
    draftStockReportJob = null;
  }
  // Tous les lundis a 13h (Europe/Paris)
  draftStockReportJob = cron.schedule('0 13 * * 1', runDraftStockReport, {
    timezone: 'Europe/Paris'
  });
  console.log('Cron rapport stock non publie configure: lundi 13h (Europe/Paris)');
};


// ==================== VEILLE CONCURRENTIELLE ====================

const { runMonitor: runCompetitorMonitor } = require("./competitorMonitorService");

let competitorMonitorJob = null;

const runCompetitorMonitorJob = async () => {
  try {
    const r = await runCompetitorMonitor();
    if (!r.skipped) {
      console.log(`Veille concurrentielle: ${r.ok}/${r.total} OK, ${r.changes?.length || 0} changement(s), ${r.errors?.length || 0} erreur(s)`);
    }
  } catch (error) {
    console.error("Erreur cron veille concurrentielle:", error.message);
    sendAlert(
      "Cron veille concurrentielle: echec",
      `Le releve quotidien des prix concurrents a echoue.\n\nErreur: ${error.message}`
    );
  }
};

const setupCompetitorMonitorCron = () => {
  if (competitorMonitorJob) {
    competitorMonitorJob.stop();
    competitorMonitorJob = null;
  }
  // Tous les jours a 8h00 (Europe/Paris)
  competitorMonitorJob = cron.schedule("0 8 * * *", runCompetitorMonitorJob, {
    timezone: "Europe/Paris"
  });
  console.log("Cron veille concurrentielle configure: tous les jours a 8h (Europe/Paris)");
};


// ==================== SOUS-MARQUES (pwb-brand) ====================
// yousync v1.4.0 renvoie sub_brand vide quand un produit porte le terme
// pwb-brand parent ET son enfant. Le correctif plugin (v1.4.1) est efface a
// chaque deploiement Deployer du site, la correction vit donc cote backend :
// on reconstruit la correspondance depuis WordPress et on realigne products.

const { refreshBrandMap } = require("./brandMapService");

let brandMapCronJob = null;

const runBrandMapJob = async () => {
  try {
    const r = await refreshBrandMap();
    if (r.filled > 0 || r.cleared > 0) {
      console.log(`Sous-marques: ${r.mapped} produit(s) mappe(s) sur ${r.products}, ${r.filled} corrige(s), ${r.cleared} vide(s)`);
    }
  } catch (error) {
    console.error("Erreur cron sous-marques:", error.message);
  }
};

const setupBrandMapCron = () => {
  if (brandMapCronJob) {
    brandMapCronJob.stop();
    brandMapCronJob = null;
  }
  // Toutes les heures a la 10e minute : delai max avant qu'une sous-marque
  // nouvellement affectee dans WordPress apparaisse dans l'app.
  brandMapCronJob = cron.schedule("10 * * * *", runBrandMapJob, {
    timezone: "Europe/Paris"
  });
  console.log("Cron sous-marques configure: toutes les heures (Europe/Paris)");
};


// ==================== BOUTIQUES NEXTORE (catalogue + stock) ====================
// Nextore ne fournit pas d'historique de stock : on l'alimente nous-memes via un
// journal des changements (nextore_stock_history). Deux crons decouples :
//  - Catalogue (6 Mo, change peu)      : toutes les 30 min, 8h-20h
//  - Stock (leger, alimente l'historique) : toutes les 10 min pendant l'ouverture 9h30-19h
//  - Passage complet de securite chaque nuit a 23h50

const nextoreModel = require('../models/nextoreModel');
const nextoreMatchService = require('./nextoreMatchService');

let nextoreCatalogJob = null;
let nextoreStockJobs = [];
let nextoreSalesJob = null;
let nextoreNightlyJob = null;

const runNextoreCatalog = async () => {
  try {
    const r = await nextoreModel.syncCatalog();
    console.log(`Nextore catalogue: ${r.products} produits (${r.durationMs} ms)`);
  } catch (error) {
    console.error('Erreur cron Nextore catalogue:', error.message);
    sendAlert('Cron boutiques Nextore (catalogue): echec',
      `La synchro du catalogue des boutiques a echoue.\n\nErreur: ${error.message}`);
  }
};

const runNextoreStock = async () => {
  try {
    const r = await nextoreModel.syncStock();
    console.log(`Nextore stock: MTP ${r.changes[1]} chg / CAST ${r.changes[2]} chg (${r.durationMs} ms)`);
  } catch (error) {
    console.error('Erreur cron Nextore stock:', error.message);
  }
};

const runNextoreSales = async () => {
  try {
    const r = await nextoreModel.syncRecentSales(3);
    console.log(`Nextore ventes: ${r.inserted} lignes reimportees (${r.range[0]} -> ${r.range[1]})`);
  } catch (error) {
    console.error('Erreur cron Nextore ventes:', error.message);
    sendAlert('Cron boutiques Nextore (ventes): echec',
      `La synchro quotidienne des ventes des boutiques a echoue.\n\nErreur: ${error.message}`);
  }
};

const runNextoreNightly = async () => {
  try {
    const r = await nextoreModel.syncAll();
    console.log(`Nextore complet (nuit): ${r.products} produits, stock MTP=${r.stock[1]} CAST=${r.stock[2]} (${r.durationMs} ms)`);
    // Rapprochement caisse <-> site : les nouveaux produits arrivent avec une
    // proposition prete a relire. Les liens deja valides ou rejetes ne sont
    // jamais retouches (cf. nextoreMatchService), le cron ne peut donc pas
    // defaire un arbitrage humain.
    try {
      const m = await nextoreMatchService.runMatching({ onlyInStock: true });
      console.log(`Nextore rapprochement: ${m.ean} EAN, ${m.name} nom, ${m.none} sans piste, ${m.skippedLocked} deja arbitres (${m.durationMs} ms)`);
    } catch (err) {
      // Un echec du rapprochement ne doit pas masquer le succes de la synchro
      console.error('Erreur cron Nextore rapprochement:', err.message);
    }
  } catch (error) {
    console.error('Erreur cron Nextore complet:', error.message);
    sendAlert('Cron boutiques Nextore (complet): echec',
      `La synchro complete nocturne des boutiques a echoue.\n\nErreur: ${error.message}`);
  }
};

const setupNextoreCrons = () => {
  nextoreCatalogJob?.stop();
  nextoreStockJobs.forEach((j) => j.stop());
  nextoreSalesJob?.stop();
  nextoreNightlyJob?.stop();

  const tz = { timezone: 'Europe/Paris' };
  // Catalogue : toutes les 30 min, 8h-20h
  nextoreCatalogJob = cron.schedule('*/30 8-20 * * *', runNextoreCatalog, tz);
  // Stock : toutes les 10 min pendant l'ouverture 9h30 -> 19h00
  nextoreStockJobs = [
    cron.schedule('30,40,50 9 * * *', runNextoreStock, tz),  // 9h30, 9h40, 9h50
    cron.schedule('*/10 10-18 * * *', runNextoreStock, tz),  // 10h00 -> 18h50
    cron.schedule('0 19 * * *',       runNextoreStock, tz),  // 19h00
  ];
  // Ventes : chaque soir a 23h40, reimporte les 3 derniers jours (retours/edits)
  nextoreSalesJob = cron.schedule('40 23 * * *', runNextoreSales, tz);
  // Passage complet de securite chaque nuit
  nextoreNightlyJob = cron.schedule('50 23 * * *', runNextoreNightly, tz);

  console.log('Crons boutiques Nextore configures: catalogue */30 8-20h, stock */10 9h30-19h, ventes 23h40, complet + rapprochement 23h50 (Europe/Paris)');
};


module.exports = {
  setupCron,
  restartCron,
  fetchReviewsAuto,
  setupBmsCron,
  setupComputedCostCron,
  setupBmsBarcodeCron,
  setupBmsShelfLocationCron,
  setupStockResyncCron,
  setupSavAutomationsCron,
  setupProductDbSyncCron,
  setupBmsTagRetryCron,
  setupReportEmailCron,
  setupStockValuationSnapshotCron,
  setupDraftStockReportCron,
  setupCompetitorMonitorCron,
  setupBrandMapCron,
  setupNextoreCrons,
  runProductDbSyncJob,
  runBrandMapJob,
  runNextoreCatalog,
  runNextoreStock,
  runNextoreSales,
  runNextoreNightly,
};
