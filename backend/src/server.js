const express = require('express');
const cors = require('cors');
require('dotenv').config({ path: '../.env' });

const authRoutes = require('./routes/auth');
const reviewsRoutes = require('./routes/reviewsRoutes');
const { setupCron } = require('./services/cronService');

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

// Start server
app.listen(PORT, async () => {
  console.log(`✓ Backend server running on port ${PORT}`);

  // Initialiser le cron pour la récupération automatique des avis
  await setupCron();
});