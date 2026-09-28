/**
 * Routes du contrôle des factures fournisseur.
 *
 * Montées derrière `authMiddleware` et le droit `purchases` : contrôler une
 * facture, c'est du travail d'achat, et les personnes concernées ont déjà ce
 * droit. Une clé de permission propre pourra être introduite le jour où la
 * tuile sera séparée dans le launcher — ce sera un changement d'une ligne ici.
 */

const express = require('express');
const multer = require('multer');
const controller = require('../controllers/supplierInvoicesController');
const { checkPermission } = require('../middleware/permissionMiddleware');

const router = express.Router();

// 15 Mo : une facture scannée de plusieurs pages passe largement, et au-delà
// c'est qu'on dépose autre chose qu'une facture.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const canRead = checkPermission('purchases', 'read');
const canWrite = checkPermission('purchases', 'write');

// Routes fixes AVANT /:id, sinon « unpaid » et « payments » seraient pris pour
// des identifiants (le piège classique, déjà commenté dans purchasesRoutes).
router.get('/parsers', canRead, controller.getParsers);
router.get('/unpaid', canRead, controller.listUnpaid);
router.get('/payments', canRead, controller.listPayments);
router.post('/payments', canWrite, controller.createPayment);

router.get('/', canRead, controller.listDocuments);
router.post('/', canWrite, upload.single('file'), controller.uploadDocument);

router.get('/:id', canRead, controller.getDocument);
router.get('/:id/file', canRead, controller.downloadDocument);
router.get('/:id/claim', canRead, controller.getClaimMessage);
router.put('/:id/status', canWrite, controller.updateStatus);
router.delete('/:id', canWrite, controller.deleteDocument);

module.exports = router;
