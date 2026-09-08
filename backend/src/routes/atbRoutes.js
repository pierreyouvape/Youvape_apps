const express = require('express');
const router = express.Router();
const atbController = require('../controllers/atbController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * ATB — Anthony Tool Box.
 *
 * Le JWT est posé au montage dans server.js (`app.use('/api/atb', authMiddleware, ...)`).
 * Ici on ajoute le droit applicatif : `atb` en lecture suffit pour tous les
 * modules de consultation. Les modules d'écriture à venir demanderont `write`.
 */
router.use(checkPermission('atb', 'read'));

// Module « Commandes / jour » : histogramme journalier + comparatifs M-1 / N-1
router.get('/orders/daily', atbController.getDailyOrders);

module.exports = router;
