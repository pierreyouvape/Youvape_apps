const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shippingController');

// Paramètres généraux
router.get('/settings', shippingController.getSettings);
router.put('/settings', shippingController.updateSettings);

// Transporteurs
router.get('/carriers', shippingController.getCarriers);
router.put('/carriers/:id', shippingController.updateCarrier);

// Méthodes de livraison
router.get('/carriers/:carrierId/methods', shippingController.getMethods);
router.post('/carriers/:carrierId/methods', shippingController.createMethod);
router.put('/methods/:id', shippingController.updateMethod);
router.delete('/methods/:id', shippingController.deleteMethod);

// Tranches de prix
router.get('/methods/:methodId/rates', shippingController.getRates);
router.post('/methods/:methodId/rates', shippingController.createRate);
router.put('/rates/:id', shippingController.updateRate);
router.delete('/rates/:id', shippingController.deleteRate);

// Calcul et application des frais
router.post('/calculate', shippingController.calculateShippingCosts);
router.post('/apply', shippingController.applyShippingCosts);

// Zones de livraison (import WooCommerce)
router.get('/zones', shippingController.getZones);
router.put('/zones/:id', shippingController.updateZone);
router.put('/zone-methods/:id', shippingController.updateZoneMethod);

// Méthodes par transporteur avec tarifs par zone
router.get('/carrier/:carrier/methods', shippingController.getMethodsByCarrier);
router.post('/method-zone-rates', shippingController.createMethodZoneRate);
router.put('/method-zone-rates/:id', shippingController.updateMethodZoneRate);
router.delete('/method-zone-rates/:id', shippingController.deleteMethodZoneRate);

module.exports = router;
