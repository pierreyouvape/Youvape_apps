const express = require('express');
const router = express.Router();
const receptionController = require('../controllers/receptionController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkPermission } = require('../middleware/permissionMiddleware');

// Toutes les routes sont protégées par le JWT
router.use(authMiddleware);

const checkReceptionRead = checkPermission('reception', 'read');

router.get('/suppliers', checkReceptionRead, receptionController.getSuppliersWithPending);
router.get('/orders', checkReceptionRead, receptionController.getPendingOrders);
router.get('/orders/:id', checkReceptionRead, receptionController.getOrderDetail);

const checkReceptionWrite = checkPermission('reception', 'write');

// La réception : compter, puis envoyer.
//
// La sémantique de POST /v2/purchase-orders/{id}/receive a été vérifiée en réel
// le 29/09/2026 sur la commande d'essai « Test Maxime » (BMS 121392). Deux
// enseignements décisifs, portés par receptionSessionModel :
//   • `items[].id` est l'identifiant de LA LIGNE chez BMS, ni le SKU ni le produit ;
//   • `qty` est un nombre de PIÈCES, jamais de packs — envoyer 1 sur une ligne
//     « 1 pack de 5 » met UNE pièce en stock tout en soldant la ligne et en
//     passant le bon en « complete ».
router.get('/orders/:id/lifecycle', checkReceptionRead, receptionController.getLifecycle);
router.get('/orders/:id/session', checkReceptionRead, receptionController.getSession);
router.post('/orders/:id/session', checkReceptionWrite, receptionController.openSession);
router.put('/sessions/:sessionId/counts/:itemId', checkReceptionWrite, receptionController.setCount);
router.post('/sessions/:sessionId/lines', checkReceptionWrite, receptionController.addLine);
router.post('/sessions/:sessionId/refresh', checkReceptionWrite, receptionController.refreshSession);
router.post('/sessions/:sessionId/validate', checkReceptionWrite, receptionController.validateSession);
router.post('/sessions/:sessionId/abandon', checkReceptionWrite, receptionController.abandonSession);

// Réglages de l'app : à qui partent les mails d'écart. La lecture suit le droit
// de lecture, l'écriture celui d'écriture — c'est un réglage d'équipe, pas un
// secret, et le magasinier doit pouvoir vérifier que quelqu'un sera prévenu.
router.get('/settings', checkReceptionRead, receptionController.getSettings);
router.put('/settings', checkReceptionWrite, receptionController.updateSettings);

module.exports = router;
