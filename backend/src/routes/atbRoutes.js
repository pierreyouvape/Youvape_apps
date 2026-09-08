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

/*
 * Module « Recherche de commandes » — critères croisés.
 *
 * La recherche est en POST : l'arbre de règles est structuré, et une query string
 * buterait sur la longueur d'URL dès quelques produits sélectionnés.
 *
 * Les statuts sont réutilisés de /api/orders/statuses/list : même colonne
 * (post_status), donc aucun risque de divergence.
 *
 * ⚠️ En revanche les transporteurs NE sont PAS repris de /api/orders/carriers/list.
 * Cette liste porte `shipping_carrier` (le transporteur assigné, vide sur 3 447
 * commandes en 3 mois) alors que la règle filtre `shipping_method` (le mode choisi
 * par le client, complet, et convention du projet). Servir l'une pour filtrer
 * l'autre donnerait un menu dont aucune valeur ne correspond.
 */
router.post('/orders/search', atbController.searchOrders);
router.post('/orders/search/export', atbController.exportOrders);

router.get('/search/cities', atbController.getCities);
router.get('/search/products', atbController.getProducts);
router.get('/search/facets', atbController.getSearchFacets);

router.get('/search/saved', atbController.getSavedSearches);
router.put('/search/saved', atbController.saveSavedSearches);

module.exports = router;
