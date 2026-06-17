const express = require('express');
const router = express.Router();
const multer = require('multer');
const clientSavController = require('../controllers/clientSavController');
const clientSavMiddleware = require('../middleware/clientSavMiddleware');

// Pièces jointes à la création — mêmes limites que le SAV agent (25 Mo, 10 max).
// memoryStorage : les fichiers sont persistés par saveAttachments() une fois le
// ticket créé (on connaît alors son id pour le dossier de destination).
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 10;
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// ─── Espace client SAV — "Mes demandes au service client" ─────────────────────
// Surface appelée en server-to-server par le plugin WordPress youvape-sav-client.
// clientSavMiddleware authentifie l'appel (secret CLIENT_SAV_SECRET) et résout
// l'identité du client (req.clientCustomerId / req.clientWpUserId). Appliqué à
// TOUTES les routes : aucune route de ce module n'est accessible sans scoping.
router.use(clientSavMiddleware);

// Lot 1 — lecture seule
router.get('/tickets', clientSavController.getMyTickets);
router.get('/orders',  clientSavController.getMyOrders);

// Lot 2 — détail & fil
router.get('/tickets/:id', clientSavController.getMyTicket);

// Lot 3 — création (multipart : champs + pièces jointes)
// L'identité du client est lue depuis l'en-tête x-wp-user-id par le middleware
// (déjà exécuté via router.use), donc disponible avant le parsing multipart.
router.post('/tickets', memoryUpload.array('attachments', MAX_FILES), clientSavController.createMyTicket);

// Lot 4 — réponse du client à un ticket existant (multipart : message + PJ)
router.post('/tickets/:id/reply', memoryUpload.array('attachments', MAX_FILES), clientSavController.replyToMyTicket);

module.exports = router;
