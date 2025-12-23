/**
 * Webhook Routes - Endpoints pour YouSync (sync temps réel)
 */

const express = require('express');
const router = express.Router();
const { verifyToken, receiveSync } = require('../controllers/webhookController');

// Health check (sans token pour test de connexion)
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Webhook endpoint is ready',
    timestamp: new Date().toISOString()
  });
});

// Sync endpoint - reçoit les événements de YouSync
router.post('/sync', verifyToken, receiveSync);

module.exports = router;
