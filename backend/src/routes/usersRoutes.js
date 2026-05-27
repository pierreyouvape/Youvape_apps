const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkAdmin } = require('../middleware/permissionMiddleware');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// Liste simple des agents (tous les utilisateurs auth, pour dropdown assignation SAV)
router.get('/agents', usersController.getAgents);

// Récupérer tous les utilisateurs (admin uniquement)
router.get('/', checkAdmin, usersController.getAllUsers);

// Récupérer mes permissions
router.get('/me/permissions', usersController.getMyPermissions);

// Mettre à jour le mot de passe BMS de l'utilisateur connecté
router.put('/me/bms-password', usersController.updateMyBmsPassword);

// Préférences d'affichage de l'utilisateur connecté (Home, ordre apps, taille tuiles…)
router.get('/me/preferences', usersController.getMyPreferences);
router.put('/me/preferences', usersController.updateMyPreferences);

// Mettre à jour les permissions d'un utilisateur (admin uniquement)
router.put('/:userId/permissions', checkAdmin, usersController.updateUserPermissions);

// Supprimer un utilisateur (admin uniquement)
router.delete('/:userId', checkAdmin, usersController.deleteUser);

module.exports = router;
