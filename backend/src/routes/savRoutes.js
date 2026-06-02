const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const savController = require('../controllers/savController');
const savMacroController = require('../controllers/savMacroController');
const savNotificationController = require('../controllers/savNotificationController');
const savAutomationController = require('../controllers/savAutomationController');
const authMiddleware = require('../middleware/authMiddleware');

const UPLOAD_ROOT = path.join('/usr/src/app/uploads/sav');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 Mo
const MAX_FILES = 10;

// Stockage temporaire en mémoire — les fichiers sont déplacés vers leur dossier
// final dans le contrôleur, une fois le ticket validé.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// ─── Webhook Gravity Forms (auth par secret header) ───────────────────────────
router.post('/webhook', savController.webhookGravityForms);

// ─── Inbound email Mailgun — multipart/form-data ou urlencoded ───────────────
const inboundParser = (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    memoryUpload.any()(req, res, next);
  } else {
    express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
  }
};
router.post('/inbound-email', inboundParser, savController.inboundEmail);

// ─── Servir une pièce jointe d'un ticket ──────────────────────────────────────
router.get('/attachments/:ticketId/:filename', (req, res) => {
  const { ticketId, filename } = req.params;
  // Whitelist stricte sur ticketId (entier) et filename (alphanumérique + . _ -)
  if (!/^\d+$/.test(ticketId) || !/^[A-Za-z0-9._-]+$/.test(filename)) {
    return res.status(400).json({ error: 'Paramètres invalides' });
  }
  const filePath = path.join(UPLOAD_ROOT, ticketId, filename);
  // Vérifier que le chemin résolu reste bien dans UPLOAD_ROOT (parade path traversal)
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(UPLOAD_ROOT) + path.sep)) {
    return res.status(400).json({ error: 'Chemin invalide' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: 'Fichier introuvable' });
  }
  res.sendFile(resolved);
});

// ─── Tracking transporteur ────────────────────────────────────────────────────
router.get('/tracking/:number', savController.getTracking);

// ─── Historique commandes d'un client (pour NewTicketPage) ───────────────────
router.get('/customer-orders/:wp_user_id', savController.getCustomerOrders);

// ─── Routes vues ──────────────────────────────────────────────────────────────
router.get('/views',              savController.getViews);
router.post('/views',             savController.createView);
router.put('/views/reorder',      savController.reorderViews);
router.put('/views/:id',          savController.updateView);
router.delete('/views/:id',       savController.deleteView);

// ─── Routes statuts ───────────────────────────────────────────────────────────
router.get('/statuses',          savController.getStatuses);
router.post('/statuses',         savController.createStatus);
router.put('/statuses/:id',      savController.updateStatus_s);
router.delete('/statuses/:id',   savController.deleteStatus);

// ─── Routes notifications (par utilisateur — protégées) ──────────────────────
router.get('/notifications',            authMiddleware, savNotificationController.getMine);
router.post('/notifications',           authMiddleware, savNotificationController.create);
router.patch('/notifications/:id',      authMiddleware, savNotificationController.update);
router.delete('/notifications/:id',     authMiddleware, savNotificationController.delete);

// ─── Routes automatismes (globales équipe — protégées) ──────────────────────
router.get('/automations',              authMiddleware, savAutomationController.getAll);
router.post('/automations',             authMiddleware, savAutomationController.create);
router.patch('/automations/:id',        authMiddleware, savAutomationController.update);
router.delete('/automations/:id',       authMiddleware, savAutomationController.delete);
router.post('/automations/:id/run',     authMiddleware, savAutomationController.runNow);

// ─── Routes macros ────────────────────────────────────────────────────────────
router.get('/macros/placeholders',      savMacroController.getPlaceholders);
router.get('/macros',                   savMacroController.getAll);
router.get('/macros/:id/attachment',    savMacroController.getAttachment);
router.post('/macros',                  memoryUpload.array('attachment', 1), savMacroController.create);
router.put('/macros/:id',               memoryUpload.array('attachment', 1), savMacroController.update);
router.delete('/macros/:id',            savMacroController.delete);

// ─── Routes internes app ──────────────────────────────────────────────────────
router.get('/',                        savController.getAll);
router.post('/',                       memoryUpload.array('attachments', MAX_FILES), savController.createManual);
router.get('/order/:order_id',         savController.getByOrderId);
router.get('/customer/:customer_id',   savController.getByCustomerId);
router.get('/:id',                     savController.getById);
router.patch('/:id',                   savController.patchTicket);
router.put('/:id/status',              savController.updateStatus);
router.post('/:id/reply', memoryUpload.array('attachments', MAX_FILES), savController.reply);
router.put('/:id/notes',               savController.updateNotes);

module.exports = router;
