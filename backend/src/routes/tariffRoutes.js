const express = require('express');
const router = express.Router();
const tariffController = require('../controllers/tariffController');

// Configuration des transporteurs
router.get('/carriers', tariffController.getCarriersConfig);

// Liste des pays
router.get('/countries', tariffController.getCountries);

// Zones par transporteur/méthode
router.get('/zones/:carrier/:method', tariffController.getZones);
router.post('/zones/:carrier/:method', tariffController.createZone);
router.delete('/zones/:id', tariffController.deleteZone);
router.put('/zones/:id/fuel-surcharge', tariffController.updateZoneFuelSurcharge);

// Tarifs (tranches de poids)
router.post('/rates', tariffController.createRate);
router.post('/rates/bulk-import', tariffController.bulkImportRates);
router.put('/rates/:id', tariffController.updateRate);
router.delete('/rates/:id', tariffController.deleteRate);

// Mapping pays -> zone
router.get('/country-mapping', tariffController.getCountryMapping);
router.get('/zone-names', tariffController.getAllZoneNames);
router.post('/country-mapping', tariffController.upsertCountryMapping);
router.delete('/country-mapping/:id', tariffController.deleteCountryMapping);

module.exports = router;
