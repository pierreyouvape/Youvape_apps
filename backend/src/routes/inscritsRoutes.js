const express = require('express');
const router = express.Router();
const inscritsController = require('../controllers/inscritsController');

// Inscrits sans commande, regroupés par jour d'inscription
router.get('/', inscritsController.getWithoutOrders);

module.exports = router;
