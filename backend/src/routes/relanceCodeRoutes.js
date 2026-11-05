const express = require('express');
const multer = require('multer');
const router = express.Router();
const relanceCodeController = require('../controllers/relanceCodeController');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Relance code promo : clients n'ayant jamais utilisé un code (liste pour Probance).
// JWT posé au montage dans server.js ; même droit que « Inscrits sans commande »,
// l'autre extraction d'e-mails destinée aux campagnes.
const read = checkPermission('inscrits', 'read');
const write = checkPermission('inscrits', 'write');

// Export Probance : un CSV, 30 Mo au plus (limite de nginx.conf), gardé en mémoire le temps du tri.
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
const csvFile = (req, res, next) => csvUpload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop lourd (30 Mo maximum)' : err.message });
  return next();
});

router.get('/', read, relanceCodeController.list);
router.get('/export', read, relanceCodeController.exportCsv);
router.post('/clean', write, csvFile, relanceCodeController.cleanProbance);

// Suivi des envois et des clients fidélisés
router.get('/campaigns', read, relanceCodeController.listCampaigns);
router.post('/campaigns', write, relanceCodeController.createFromFilters);
router.put('/campaigns/:id', write, relanceCodeController.updateCampaign);
router.delete('/campaigns/:id', write, relanceCodeController.deleteCampaign);

module.exports = router;
