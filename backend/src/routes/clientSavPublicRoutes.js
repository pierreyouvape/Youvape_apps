const express = require('express');
const router = express.Router();
const multer = require('multer');
const clientSavController = require('../controllers/clientSavController');
const clientSavPublicMiddleware = require('../middleware/clientSavPublicMiddleware');

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_FILES = 10;
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// ─── Espace client SAV — surface PUBLIQUE (visiteur non connecté) ─────────────
// Routeur volontairement SÉPARÉ de clientSavRoutes : celui-ci n'a aucune
// identité à scoper, il ne doit donc jamais exposer de lecture. Toute route
// ajoutée ici doit être une création.
router.use(clientSavPublicMiddleware);

router.post('/tickets', memoryUpload.array('attachments', MAX_FILES), clientSavController.createPublicTicket);

module.exports = router;
