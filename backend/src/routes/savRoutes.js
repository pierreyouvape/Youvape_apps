const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const savController = require('../controllers/savController');
const clientSavController = require('../controllers/clientSavController');
const savMacroController = require('../controllers/savMacroController');
const savNotificationController = require('../controllers/savNotificationController');
const savAutomationController = require('../controllers/savAutomationController');
const zendeskController = require('../controllers/zendeskController');
const authMiddleware = require('../middleware/authMiddleware');
const { recordInboundFailure } = require('../utils/savInboundFailure');

const UPLOAD_ROOT = path.join('/usr/src/app/uploads/sav');
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 Mo
const MAX_FILES = 10;

// Stockage temporaire en mémoire — les fichiers sont déplacés vers leur dossier
// final dans le contrôleur, une fois le ticket validé.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// ─── Limites propres à l'EMAIL ENTRANT ───────────────────────────────────────
// Un client qui photographie un colis abîmé sous tous les angles dépasse
// facilement la dizaine de fichiers — et le SAV lui en réclame lui-même. Le
// plafond de 10 partagé avec les autres routes faisait rejeter ces messages
// AVANT le contrôleur, donc sans le moindre filet (cas M. Jabur, 24 photos
// pour 7 Mo, jamais arrivé et jamais signalé).
const INBOUND_MAX_FILES = 50;
const INBOUND_MAX_FILE_SIZE = 10 * 1024 * 1024;  // 10 Mo par fichier
const INBOUND_MAX_TOTAL_SIZE = 40 * 1024 * 1024; // 40 Mo pour tout le message

const inboundUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INBOUND_MAX_FILE_SIZE, files: INBOUND_MAX_FILES },
});

// ─── Webhook Gravity Forms (auth par secret header) ───────────────────────────
router.post('/webhook', savController.webhookGravityForms);

// ─── Inbound email Mailgun — multipart/form-data ou urlencoded ───────────────
/**
 * Un message refusé ici ne doit JAMAIS disparaître en silence.
 *
 * On répond 200 à Mailgun — un code d'erreur déclencherait des réessais qui
 * échoueraient à l'identique, puis un abandon sans trace — et on met le message
 * de côté dans `sav_inbound_failures`, avec alerte à l'équipe.
 *
 * Les pièces jointes, elles, sont bel et bien perdues : on refuse justement de
 * les lire, et le stockage Mailgun est désactivé côté domaine. D'où des plafonds
 * volontairement larges : mieux vaut accepter le message que savoir
 * élégamment qu'on l'a perdu. Ce filet ne couvre que le cas extrême.
 *
 * Multer avorte le parsing dès l'erreur : `req.body` ne contient donc que les
 * champs lus avant. Mailgun envoyant ses champs texte d'abord, on récupère en
 * général l'expéditeur et le sujet — assez pour rappeler le client.
 */
const handleInboundRejection = async (req, res, error, detail = '') => {
  console.error('❌ [SAV Inbound] Message refusé au parsing:', error);
  const b = req.body || {};
  await recordInboundFailure({
    payload: b,
    error,
    sender: b.sender || b.from || null,
    subject: b.subject || b.Subject || null,
    messageId: b['Message-Id'] || b['message-url'] || null,
    alertTitle: 'Email SAV refusé (trop volumineux)',
    alertDetail: detail
      + `\n⚠️ Les pièces jointes de ce message sont DÉFINITIVEMENT perdues : `
      + `rappelez le client pour qu'il les renvoie en plusieurs fois.`,
  });
  // 200 volontaire : le message est pris en charge de notre côté (mis de côté),
  // il n'y a rien à réessayer.
  res.status(200).json({ success: false, stored_for_review: true });
};

const inboundParser = (req, res, next) => {
  const ct = req.headers['content-type'] || '';

  // Garde-fou global : multer borne la taille d'UN fichier et leur nombre, mais
  // jamais le total. Sans ça, 50 × 10 Mo tiendraient en mémoire d'un coup.
  const declared = parseInt(req.headers['content-length'] || '0', 10);
  if (declared > INBOUND_MAX_TOTAL_SIZE) {
    const mo = (n) => Math.round(n / 1024 / 1024);
    return handleInboundRejection(
      req, res,
      `Message de ${mo(declared)} Mo, au-delà de la limite de ${mo(INBOUND_MAX_TOTAL_SIZE)} Mo`,
      'Le message a été refusé avant lecture, sur sa taille annoncée.'
    );
  }

  if (ct.includes('multipart/form-data')) {
    inboundUpload.any()(req, res, (err) => {
      if (err) {
        return handleInboundRejection(
          req, res,
          `${err.code || 'ERREUR'} — ${err.message}`,
          `Limites en vigueur : ${INBOUND_MAX_FILES} fichiers, `
          + `${INBOUND_MAX_FILE_SIZE / 1024 / 1024} Mo par fichier.`
        );
      }
      next();
    });
  } else {
    express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
  }
};
router.post('/inbound-email', inboundParser, savController.inboundEmail);

// ─── Inbound Zendesk — webhook de transition (réponses sur anciens tickets) ──
// Auth par Bearer token partagé (ZENDESK_WEBHOOK_TOKEN), JSON.
const verifyZendeskWebhook = (req, res, next) => {
  const expected = process.env.ZENDESK_WEBHOOK_TOKEN;
  if (!expected) {
    console.error('❌ [SAV Zendesk] ZENDESK_WEBHOOK_TOKEN non configuré');
    return res.status(500).json({ error: 'Webhook non configuré' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token || token !== expected) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  next();
};
router.post('/inbound-zendesk', verifyZendeskWebhook, express.json({ limit: '10mb' }), savController.inboundZendesk);

// ─── Servir une pièce jointe d'un ticket ──────────────────────────────────────
const { isHeic, heicToJpegCached } = require('../utils/heicConvert');

router.get('/attachments/:ticketId/:filename', async (req, res) => {
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

  // Les navigateurs (hors Safari) n'affichent pas le HEIC. Avec ?format=jpeg,
  // on sert une version JPEG convertie à la volée (cache disque). En cas
  // d'échec de conversion, on retombe sur le fichier d'origine.
  if (req.query.format === 'jpeg' && isHeic(null, filename)) {
    try {
      const jpegPath = await heicToJpegCached(resolved);
      res.type('image/jpeg');
      return res.sendFile(jpegPath);
    } catch (e) {
      console.warn(`[SAV] Conversion HEIC→JPEG échouée (${filename}) :`, e.message);
      // fallback : on sert l'original ci-dessous
    }
  }

  res.sendFile(resolved);
});

// ─── Flux temps réel des changements de tickets (SSE) ────────────────────────
router.get('/stream', savController.stream);

// ─── Tracking transporteur ────────────────────────────────────────────────────
router.get('/tracking/:number', savController.getTracking);

// ─── Historique commandes d'un client (pour NewTicketPage) ───────────────────
router.get('/customer-orders/:wp_user_id', savController.getCustomerOrders);

// ─── Recherche d'une commande par n° (lie le client, pour NewTicketPage) ─────
router.get('/order-lookup/:order_id', savController.getOrderByRef);

// ─── Routes vues ──────────────────────────────────────────────────────────────
router.get('/views',              savController.getViews);
router.post('/views',             savController.createView);
router.put('/views/reorder',      savController.reorderViews);
router.put('/views/:id',          savController.updateView);
router.delete('/views/:id',       savController.deleteView);

// ─── Espace client SAV — secret partagé (onglet DANGER) ──────────────────────
// Configuré depuis l'app, stocké en base (app_config), pas de .env à toucher.
router.get('/client-sav-secret',          clientSavController.getSecret);
router.put('/client-sav-secret',          clientSavController.setSecret);
router.post('/client-sav-secret/generate', clientSavController.generateSecret);

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

// ─── Routes import Zendesk ─────────────────────────────────────────────────────
router.get('/zendesk/config',           zendeskController.getConfig);
router.put('/zendesk/config',           zendeskController.saveConfig);
router.post('/zendesk/test',            zendeskController.testConnection);
router.get('/zendesk/preview-statuses', zendeskController.previewStatuses);
router.get('/zendesk/status-map',       zendeskController.getStatusMap);
router.put('/zendesk/status-map',       zendeskController.saveStatusMap);
router.get('/zendesk/preview-fields',   zendeskController.previewFields);
router.get('/zendesk/field-map',        zendeskController.getFieldMap);
router.put('/zendesk/field-map',        zendeskController.saveFieldMap);
router.get('/zendesk/import',           zendeskController.importStream);

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
router.post('/:id/inline-image', memoryUpload.single('image'), savController.uploadInlineImage);
router.post('/:id/merge',              savController.mergeTicket);
router.put('/:id/notes',               savController.updateNotes);
// Note portée par la fiche client (≠ note du ticket ci-dessus). Trois segments,
// donc aucun recouvrement avec '/:id/notes'.
router.put('/customers/:customerId/note', savController.updateCustomerNote);

module.exports = router;
