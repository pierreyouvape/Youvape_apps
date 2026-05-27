const express = require('express');
const router = express.Router();
const multer = require('multer');
const savController = require('../controllers/savController');

const upload = multer(); // multipart/form-data sans stockage fichier

// ─── Webhook Gravity Forms (auth par secret header) ───────────────────────────
router.post('/webhook', savController.webhookGravityForms);

// ─── Inbound email Mailgun — multipart/form-data ──────────────────────────────
router.post('/inbound-email', upload.none(), savController.inboundEmail);

// ─── Routes internes app ──────────────────────────────────────────────────────
router.get('/',                        savController.getAll);
router.post('/',                       savController.createManual);
router.get('/order/:order_id',         savController.getByOrderId);
router.get('/customer/:customer_id',   savController.getByCustomerId);
router.get('/:id',                     savController.getById);
router.put('/:id/status',              savController.updateStatus);
router.post('/:id/reply',              savController.reply);
router.put('/:id/notes',               savController.updateNotes);

module.exports = router;
