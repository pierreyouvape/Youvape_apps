const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// GET /api/payment/methods - Liste des méthodes de paiement
router.get('/methods', paymentController.getMethods);

// GET /api/payment/methods/:id - Détail d'une méthode
router.get('/methods/:id', paymentController.getMethod);

// POST /api/payment/methods - Créer une méthode
router.post('/methods', paymentController.createMethod);

// PUT /api/payment/methods/:id - Mettre à jour une méthode
router.put('/methods/:id', paymentController.updateMethod);

// DELETE /api/payment/methods/:id - Supprimer une méthode
router.delete('/methods/:id', paymentController.deleteMethod);

module.exports = router;
