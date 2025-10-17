const userPermissionsModel = require('../models/userPermissionsModel');

/**
 * Middleware pour vérifier les permissions d'un utilisateur sur une app
 * @param {string} appName - Nom de l'app (reviews, rewards, emails)
 * @param {string} permissionType - Type de permission ('read' ou 'write')
 */
const checkPermission = (appName, permissionType) => {
  return async (req, res, next) => {
    try {
      const userId = req.user.id;
      const email = req.user.email;

      // Le super admin a tous les droits
      if (userPermissionsModel.isSuperAdmin(email)) {
        return next();
      }

      // Vérifier si l'utilisateur a la permission
      const hasPermission = await userPermissionsModel.hasPermission(
        userId,
        appName,
        permissionType
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Accès refusé : vous n\'avez pas les droits nécessaires',
          required: { app: appName, permission: permissionType }
        });
      }

      next();
    } catch (error) {
      console.error('Erreur lors de la vérification des permissions:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  };
};

/**
 * Middleware pour vérifier si l'utilisateur est admin
 */
const checkAdmin = async (req, res, next) => {
  try {
    const email = req.user.email;

    // Vérifier si super admin
    if (userPermissionsModel.isSuperAdmin(email)) {
      return next();
    }

    // Vérifier si admin dans la BDD
    const pool = require('../config/database');
    const query = 'SELECT is_admin FROM users WHERE id = $1';
    const result = await pool.query(query, [req.user.id]);

    if (result.rows.length === 0 || !result.rows[0].is_admin) {
      return res.status(403).json({
        error: 'Accès refusé : droits administrateur requis'
      });
    }

    next();
  } catch (error) {
    console.error('Erreur lors de la vérification des droits admin:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
};

module.exports = {
  checkPermission,
  checkAdmin
};
