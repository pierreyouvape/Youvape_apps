const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const authRoutes = require('./routes/auth');
const reviewsRoutes = require('./routes/reviewsRoutes');
const rewardsRoutes = require('./routes/rewardsRoutes');
const emailRoutes = require('./routes/emailRoutes');
const usersRoutes = require('./routes/usersRoutes');
const syncRoutes = require('./routes/syncRoutes');
const statsRoutes = require('./routes/statsRoutes');
const customersRoutes = require('./routes/customersRoutes');
const productsRoutes = require('./routes/productsRoutes');
const ordersRoutes = require('./routes/ordersRoutes');
const brandsRoutes = require('./routes/brandsRoutes');
const categoriesRoutes = require('./routes/categoriesRoutes');
const analysisRoutes = require('./routes/analysisRoutes');
const reportsRoutes = require('./routes/reportsRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const shippingRoutes = require('./routes/shippingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const tariffRoutes = require('./routes/tariffRoutes');
const purchasesRoutes = require('./routes/purchasesRoutes');
const packingRoutes = require('./routes/packingRoutes');
const laposteRoutes = require('./routes/laposteRoutes');
const preferencesRoutes = require('./routes/preferencesRoutes');
const financierRoutes = require('./routes/financierRoutes');
const savRoutes = require('./routes/savRoutes');
const clientSavRoutes = require('./routes/clientSavRoutes');
const clientSavPublicRoutes = require('./routes/clientSavPublicRoutes');
const chronopostRoutes = require('./routes/chronopostRoutes');
const colissimoRoutes  = require('./routes/colissimoRoutes');
const lettreSuivieRoutes = require('./routes/lettreSuivieRoutes');
const mondialRelayRoutes = require('./routes/mondialRelayRoutes');
const transporteursRoutes = require('./routes/transporteursRoutes');
const competitorRoutes = require('./routes/competitorRoutes');
const receptionRoutes = require('./routes/receptionRoutes');
const inscritsRoutes = require('./routes/inscritsRoutes');
const promoRoutes = require('./routes/promoRoutes');
const nextoreRoutes = require('./routes/nextoreRoutes');
const authMiddleware = require('./middleware/authMiddleware');
const { setupCron, setupBmsCron, setupComputedCostCron, setupBmsBarcodeCron, setupBmsShelfLocationCron, setupStockResyncCron, setupSavAutomationsCron, setupProductDbSyncCron, setupBmsTagRetryCron, setupReportEmailCron, setupStockValuationSnapshotCron, setupDraftStockReportCron, setupCompetitorMonitorCron, setupBrandMapCron, setupNextoreCrons } = require('./services/cronService');
const rewardService = require('./services/rewardService');
const emailService = require('./services/emailService');
const wcSyncService = require('./services/wcSyncService');

const app = express();
const PORT = process.env.BACKEND_PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/sync', syncRoutes); // Frontend stats app
app.use('/api/woo-sync', syncRoutes); // WooCommerce module
app.use('/api/stats', authMiddleware, statsRoutes); // Stats & KPIs
app.use('/api/customers', authMiddleware, customersRoutes); // Customers
app.use('/api/products', authMiddleware, productsRoutes); // Products
app.use('/api/orders', authMiddleware, ordersRoutes); // Orders
app.use('/api/brands', authMiddleware, brandsRoutes); // Brands & Sub-brands
app.use('/api/categories', authMiddleware, categoriesRoutes); // Categories & Sub-categories
app.use('/api/analysis', authMiddleware, analysisRoutes); // Analysis & Segmentation
app.use('/api/reports', authMiddleware, reportsRoutes); // Reports
app.use('/api/webhook', webhookRoutes); // YouSync real-time webhooks (auth propre : verifyToken)
app.use('/api/settings', settingsRoutes); // App settings
app.use('/api/shipping', authMiddleware, shippingRoutes); // Shipping costs management
app.use('/api/payment', authMiddleware, paymentRoutes); // Payment methods configuration
app.use('/api/tariffs', authMiddleware, tariffRoutes); // Tariff zones and rates
app.use('/api/purchases', purchasesRoutes); // Purchase management
app.use('/api/packing', packingRoutes); // Packing / preparation colis
app.use('/api/laposte', laposteRoutes); // La Poste - étiquettes Lettre Suivie
app.use('/api/preferences', preferencesRoutes); // User column preferences
app.use('/api/financier', financierRoutes);    // Dashboard financier
app.use('/api/sav', savRoutes);               // Module SAV Zendesk
app.use('/api/client-sav', clientSavRoutes);  // Espace client SAV (plugin WP youvape-sav-client)
// Formulaire public "Nous contacter" (visiteur non connecté) : secret partagé
// seul, création uniquement. Préfixe distinct pour qu'aucune route de lecture
// scopée ne puisse s'y retrouver par erreur de montage.
app.use('/api/client-sav-public', clientSavPublicRoutes);
app.use('/api/chronopost', authMiddleware, chronopostRoutes); // Chronopost invoice analysis
app.use('/api/colissimo',  authMiddleware, colissimoRoutes);  // Colissimo invoice analysis
app.use('/api/lettre-suivie', authMiddleware, lettreSuivieRoutes); // La Poste Lettre Suivie invoice analysis
app.use('/api/mondial-relay', authMiddleware, mondialRelayRoutes); // Mondial Relay invoice analysis
app.use('/api/transporteurs', authMiddleware, transporteursRoutes); // Vue consolidée des 4 transporteurs
app.use('/api/competitors', authMiddleware, competitorRoutes); // Veille concurrentielle
app.use('/api/reception', receptionRoutes); // Réception marchandises (auth + permission dans le routeur)
app.use('/api/inscrits', authMiddleware, inscritsRoutes); // Inscrits sans commande (par jour)
app.use('/api/promos', authMiddleware, promoRoutes); // Actions Promos (préparation d'opérations)
app.use('/api/nextore', nextoreRoutes); // Boutiques physiques Nextore (auth + permission dans le routeur)

// Start server
app.listen(PORT, async () => {
  console.log(`✓ Backend server running on port ${PORT}`);

  // Initialiser le cron pour la récupération automatique des avis
  await setupCron();

  // Initialiser le cron BMS (sync commandes toutes les 30 min, 9h-19h, lun-ven)
  setupBmsCron();

  // Initialiser le cron PMP FIFO (recalcul computed_cost toutes les 30 min)
  setupComputedCostCron();

  // Initialiser le cron BMS Barcodes (sync codes-barres toutes les heures)
  setupBmsBarcodeCron();

  // Emplacements de rangement (indication pour la reception)
  setupBmsShelfLocationCron();
  // Initialiser le check re-sync stocks (one-shot programme)
  setupStockResyncCron();

  // Initialiser le cron des automatismes SAV (toutes les heures, 24/7)
  setupSavAutomationsCron();

  // Initialiser le cron de resynchro produits WC/ATUM (statut, stock, suivi de stock) - tous les jours a 3h
  setupProductDbSyncCron();

  // Initialiser le cron des sous-marques (pwb-brand) - toutes les heures
  setupBrandMapCron();

  // Initialiser le cron de rattrapage des tags BMS SAV (commandes importees apres coup)
  setupBmsTagRetryCron();

  // Initialiser le cron d'envoi automatique des rapports par email (journalier/hebdo/mensuel)
  setupReportEmailCron();

  // Initialiser le cron snapshot valeur de stock (achat HT) - tous les jours a 23h55
  setupStockValuationSnapshotCron();

  // Initialiser le cron rapport hebdo des produits en stock non publies - lundi 13h
  setupDraftStockReportCron();

  setupCompetitorMonitorCron();

  // Initialiser les crons boutiques Nextore (catalogue */30 8-20h, stock */10 9h30-19h, complet 23h50)
  setupNextoreCrons();

  // Recalcul initial PMP FIFO au demarrage (apres 60s)
  setTimeout(async () => {
    try {
      const computedCostModel = require('./models/computedCostModel');
      await computedCostModel.recalculateAll();
    } catch (e) {
      console.error('Erreur recalcul initial PMP FIFO:', e.message, e.stack);
    }
  }, 60000);

  // Lancer le processus de récompense toutes les 5 minutes
  console.log('🎁 Démarrage du système de récompenses automatique (toutes les 5 min)');
  setInterval(async () => {
    await rewardService.processRewards();
  }, 5 * 60 * 1000); // 5 minutes

  // Lancer une première fois au démarrage (après 30 secondes)
  setTimeout(async () => {
    await rewardService.processRewards();
  }, 30000);

  // Lancer le processus d'envoi d'emails toutes les 5 minutes
  console.log('📧 Démarrage du système d\'envoi d\'emails automatique (toutes les 5 min)');
  setInterval(async () => {
    await emailService.processEmails();
  }, 5 * 60 * 1000); // 5 minutes

  // Lancer une première fois au démarrage (après 45 secondes)
  setTimeout(async () => {
    await emailService.processEmails();
  }, 45000);

  // Démarrer le service de sync WooCommerce
  setTimeout(async () => {
    await wcSyncService.start();
  }, 5000);
});