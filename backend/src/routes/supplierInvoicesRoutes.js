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
// Défaire un règlement : un essai, un doublon de relevé, un montant saisi de
// travers. Les factures qu'il soldait redeviennent dues.
router.delete('/payments/:id', canWrite, controller.deletePayment);

// Lecture seule : analyse sans rien écrire. Déclarée avant '/' pour rester
// lisible à côté de son jumeau qui, lui, enregistre.
router.post('/analyse', canWrite, upload.single('file'), controller.analyseDocument);

// Déclarées avant '/:id' : sans ça, « orders » serait pris pour un identifiant.
router.post('/apply-tariffs', canWrite, controller.applyTariffs);

router.get('/orders', canRead, controller.listCandidateOrders);
// Bons de réduction à valoir sur une prochaine commande.
router.get('/vouchers', canRead, controller.listVouchers);
router.put('/vouchers/:voucherId', canWrite, controller.updateVoucher);
router.delete('/vouchers/:voucherId', canWrite, controller.deleteVoucher);
router.post('/vouchers/:voucherId/apply-prices', canWrite, controller.applyVoucherPrices);
router.get('/orders/:orderId/lifecycle', canRead, controller.getOrderLifecycle);

router.get('/', canRead, controller.listDocuments);
router.post('/', canWrite, upload.single('file'), controller.uploadDocument);

router.get('/:id', canRead, controller.getDocument);
router.get('/:id/file', canRead, controller.downloadDocument);
router.get('/:id/claim', canRead, controller.getClaimMessage);
router.put('/:id/status', canWrite, controller.updateStatus);
router.post('/:id/recheck', canWrite, controller.recheckDocument);
router.post('/:id/vouchers', canWrite, controller.createVoucher);
router.post('/:id/apply-tariffs', canWrite, controller.applyDocumentTariffs);
router.delete('/:id', canWrite, controller.deleteDocument);

module.exports = router;
