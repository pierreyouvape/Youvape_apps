const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const authMiddleware = require('../middleware/authMiddleware');
const { checkAdmin } = require('../middleware/permissionMiddleware');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

// Récupérer tous les utilisateurs (admin uniquement)
router.get('/', checkAdmin, usersController.getAllUsers);

// Récupérer mes permissions
router.get('/me/permissions', usersController.getMyPermissions);

// Mettre à jour les permissions d'un utilisateur (admin uniquement)
router.put('/:userId/permissions', checkAdmin, usersController.updateUserPermissions);

// Supprimer un utilisateur (admin uniquement)
router.delete('/:userId', checkAdmin, usersController.deleteUser);

module.exports = router;
