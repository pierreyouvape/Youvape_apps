const express = require('express');
const router = express.Router();
const savController = require('../controllers/savController');

// ─── Middleware auth JWT (routes internes app) ────────────────────────────────
const verifyZendeskToken = (req, res, next) => {
  const token = req.headers['x-zendesk-token'];
  if (!token || token !== process.env.ZENDESK_API_TOKEN) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
};

// ─── Endpoint de capture brut — log tout le payload GF pour analyse ──────────
router.post('/webhook-test', express.raw({ type: '*/*' }), (req, res) => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📥 [WEBHOOK-TEST] Headers reçus :');
  console.log(JSON.stringify(req.headers, null, 2));
  console.log('📦 [WEBHOOK-TEST] Body parsé (express.json) :');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('📄 [WEBHOOK-TEST] Body brut (raw) :');
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body);
  console.log(raw);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  res.status(200).json({ success: true, message: 'Payload reçu et loggé' });
});

// ─── Anciennes routes Zendesk (conservées temporairement) ────────────────────
router.get('/', verifyZendeskToken, savController.getAll);
router.post('/', verifyZendeskToken, savController.create);
router.get('/order/:order_id', verifyZendeskToken, savController.getByOrderId);
router.get('/customer/:customer_id', verifyZendeskToken, savController.getByCustomerId);
router.get('/zendesk/:zendesk_ticket_id', verifyZendeskToken, savController.getByZendeskId);
router.put('/:id/status', verifyZendeskToken, savController.updateStatus);

module.exports = router;
