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

// La validation d'une réception (écriture BMS) n'est pas encore exposée : la
// sémantique de POST /v2/purchase-orders/{id}/receive sur les lignes en pack
// n'est pas vérifiée en réel (cf. docs/bms/PROMPT-api-bms.md).

module.exports = router;
