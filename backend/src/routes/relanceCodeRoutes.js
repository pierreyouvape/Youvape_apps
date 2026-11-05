const express = require('express');
const router = express.Router();
const relanceCodeController = require('../controllers/relanceCodeController');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Relance code promo : clients n'ayant jamais utilisé un code (liste pour Probance).
// JWT posé au montage dans server.js ; même droit que « Inscrits sans commande »,
// l'autre extraction d'e-mails destinée aux campagnes.
const read = checkPermission('inscrits', 'read');

router.get('/', read, relanceCodeController.list);
router.get('/export', read, relanceCodeController.exportCsv);

module.exports = router;
