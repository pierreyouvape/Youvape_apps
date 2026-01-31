const pool = require('../config/database');
const userPermissionsModel = require('../models/userPermissionsModel');

const SUPER_ADMIN_EMAIL = 'youvape34@gmail.com';

const usersController = {
  // Récupérer tous les utilisateurs avec leurs permissions
  getAllUsers: async (req, res) => {
    try {
      const users = await userPermissionsModel.getAllUsersWithPermissions();

      res.json({
        success: true,
        users
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des utilisateurs:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Récupérer les permissions de l'utilisateur connecté
  getMyPermissions: async (req, res) => {
    try {
      const userId = req.user.id;
      const email = req.user.email;

      // Si super admin, retourner tous les droits
      if (userPermissionsModel.isSuperAdmin(email)) {
        return res.json({
          success: true,
          is_super_admin: true,
          is_admin: true,
          permissions: {
            reviews: { read: true, write: true },
            rewards: { read: true, write: true },
            emails: { read: true, write: true },
            stats: { read: true, write: true },
            purchases: { read: true, write: true }
          }
        });
      }

      // Récupérer depuis la BDD
      const userQuery = 'SELECT is_admin FROM users WHERE id = $1';
      const userResult = await pool.query(userQuery, [userId]);
      const isAdmin = userResult.rows[0]?.is_admin || false;

      const permissions = await userPermissionsModel.getUserPermissions(userId);

      res.json({
        success: true,
        is_super_admin: false,
        is_admin: isAdmin,
        permissions
      });
    } catch (error) {
      console.error('Erreur lors de la récupération des permissions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Mettre à jour les permissions d'un utilisateur
  updateUserPermissions: async (req, res) => {
    try {
      const { userId } = req.params;
      const { permissions, is_admin } = req.body;

      // Vérifier que l'utilisateur connecté est admin
      const requestingUserQuery = 'SELECT email, is_admin FROM users WHERE id = $1';
      const requestingUserResult = await pool.query(requestingUserQuery, [req.user.id]);
      const requestingUser = requestingUserResult.rows[0];

      const isSuperAdmin = userPermissionsModel.isSuperAdmin(requestingUser.email);

      if (!isSuperAdmin && !requestingUser.is_admin) {
        return res.status(403).json({ error: 'Accès refusé : droits administrateur requis' });
      }

      // Vérifier qu'on ne modifie pas le super admin
      const targetUserQuery = 'SELECT email FROM users WHERE id = $1';
      const targetUserResult = await pool.query(targetUserQuery, [userId]);

      if (targetUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      const targetEmail = targetUserResult.rows[0].email;

      if (userPermissionsModel.isSuperAdmin(targetEmail)) {
        return res.status(403).json({ error: 'Impossible de modifier les droits du super administrateur' });
      }

      // Mettre à jour les permissions pour chaque app
      if (permissions) {
        for (const [appName, perms] of Object.entries(permissions)) {
          await userPermissionsModel.upsertPermission(
            userId,
            appName,
            perms.read || false,
            perms.write || false
          );
        }
      }

      // Mettre à jour le statut admin si fourni
      if (typeof is_admin === 'boolean') {
        await userPermissionsModel.updateAdminStatus(userId, is_admin);
      }

      res.json({
        success: true,
        message: 'Permissions mises à jour avec succès'
      });
    } catch (error) {
      if (error.message === 'Cannot modify super admin status') {
        return res.status(403).json({ error: 'Impossible de modifier le statut du super administrateur' });
      }

      console.error('Erreur lors de la mise à jour des permissions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  },

  // Supprimer un utilisateur
  deleteUser: async (req, res) => {
    try {
      const { userId } = req.params;

      // Vérifier que l'utilisateur connecté est admin
      const requestingUserQuery = 'SELECT email, is_admin FROM users WHERE id = $1';
      const requestingUserResult = await pool.query(requestingUserQuery, [req.user.id]);
      const requestingUser = requestingUserResult.rows[0];

      const isSuperAdmin = userPermissionsModel.isSuperAdmin(requestingUser.email);

      if (!isSuperAdmin && !requestingUser.is_admin) {
        return res.status(403).json({ error: 'Accès refusé : droits administrateur requis' });
      }

      // Vérifier qu'on ne supprime pas le super admin
      const targetUserQuery = 'SELECT email FROM users WHERE id = $1';
      const targetUserResult = await pool.query(targetUserQuery, [userId]);

      if (targetUserResult.rows.length === 0) {
        return res.status(404).json({ error: 'Utilisateur non trouvé' });
      }

      const targetEmail = targetUserResult.rows[0].email;

      if (userPermissionsModel.isSuperAdmin(targetEmail)) {
        return res.status(403).json({ error: 'Impossible de supprimer le super administrateur' });
      }

      // Supprimer l'utilisateur (CASCADE supprimera les permissions)
      const deleteQuery = 'DELETE FROM users WHERE id = $1';
      await pool.query(deleteQuery, [userId]);

      res.json({
        success: true,
        message: 'Utilisateur supprimé avec succès'
      });
    } catch (error) {
      console.error('Erreur lors de la suppression de l\'utilisateur:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }
};

module.exports = usersController;
