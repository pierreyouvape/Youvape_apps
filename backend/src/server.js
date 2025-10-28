const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const authRoutes = require('./routes/auth');
const reviewsRoutes = require('./routes/reviewsRoutes');
const rewardsRoutes = require('./routes/rewardsRoutes');
const emailRoutes = require('./routes/emailRoutes');
const usersRoutes = require('./routes/usersRoutes');
const syncRoutes = require('./routes/syncRoutes');
const { setupCron } = require('./services/cronService');
const rewardService = require('./services/rewardService');
const emailService = require('./services/emailService');

const app = express();
const PORT = process.env.BACKEND_PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/sync', syncRoutes);

// Start server
app.listen(PORT, async () => {
  console.log(`✓ Backend server running on port ${PORT}`);

  // Initialiser le cron pour la récupération automatique des avis
  await setupCron();

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
});