const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Route d'inscription
router.post('/register', authController.register);

// Route de connexion
router.post('/login', authController.login);

// Connexion du PDA par badge employé (session fermée à 19h30)
router.post('/badge', authController.badgeLogin);

module.exports = router;