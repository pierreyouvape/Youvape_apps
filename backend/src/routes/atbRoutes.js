const express = require('express');
const router = express.Router();
const atbController = require('../controllers/atbController');
const { checkPermission } = require('../middleware/permissionMiddleware');

/*
 * ATB — Anthony Tool Box.
 *
 * Le JWT est posé au montage dans server.js (`app.use('/api/atb', authMiddleware, ...)`).
 * Ici on ajoute le droit applicatif : `atb` en lecture suffit pour tous les
 * modules de consultation.
 *
 * Les préférences échappent au droit `write` : enregistrer SA période et SES
 * pays n'est pas écrire dans les données de l'app, c'est du confort de lecture,
 * et c'est déjà borné à `req.user.id`.
 */
router.use(checkPermission('atb', 'read'));

// Module « Commandes / jour » : histogramme journalier + comparatifs M-1 / N-1
router.get('/orders/daily', atbController.getDailyOrders);
router.get('/orders/countries', atbController.getCountries);

// Période, pays et séries affichées, retenus d'une session à l'autre
router.get('/preferences', atbController.getPreferences);
router.put('/preferences', atbController.savePreferences);

module.exports = router;
