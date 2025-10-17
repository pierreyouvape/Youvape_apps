const pool = require('../config/database');

const SUPER_ADMIN_EMAIL = 'youvape34@gmail.com';

const userPermissionsModel = {
  // Vérifier si un utilisateur est le super admin
  isSuperAdmin: (email) => {
    return email === SUPER_ADMIN_EMAIL;
  },

  // Récupérer toutes les permissions d'un utilisateur
  getUserPermissions: async (userId) => {
    const query = `
      SELECT app_name, can_read, can_write
      FROM user_permissions
      WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);

    // Convertir en objet pour faciliter l'accès
    const permissions = {};
    result.rows.forEach(row => {
      permissions[row.app_name] = {
        read: row.can_read,
        write: row.can_write
      };
    });

    return permissions;
  },

  // Vérifier si un utilisateur a une permission spécifique
  hasPermission: async (userId, appName, permissionType) => {
    const query = `
      SELECT can_read, can_write
      FROM user_permissions
      WHERE user_id = $1 AND app_name = $2
    `;
    const result = await pool.query(query, [userId, appName]);

    if (result.rows.length === 0) {
      return false;
    }

    const perm = result.rows[0];
    if (permissionType === 'read') {
      return perm.can_read;
    } else if (permissionType === 'write') {
      return perm.can_write;
    }

    return false;
  },

  // Mettre à jour les permissions d'un utilisateur pour une app
  upsertPermission: async (userId, appName, canRead, canWrite) => {
    const query = `
      INSERT INTO user_permissions (user_id, app_name, can_read, can_write, updated_at)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, app_name)
      DO UPDATE SET
        can_read = EXCLUDED.can_read,
        can_write = EXCLUDED.can_write,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await pool.query(query, [userId, appName, canRead, canWrite]);
    return result.rows[0];
  },

  // Supprimer toutes les permissions d'un utilisateur
  deleteUserPermissions: async (userId) => {
    const query = 'DELETE FROM user_permissions WHERE user_id = $1';
    await pool.query(query, [userId]);
  },

  // Récupérer tous les utilisateurs avec leurs permissions
  getAllUsersWithPermissions: async () => {
    const query = `
      SELECT
        u.id,
        u.email,
        u.is_admin,
        u.created_at,
        COALESCE(
          json_agg(
            json_build_object(
              'app_name', up.app_name,
              'can_read', up.can_read,
              'can_write', up.can_write
            )
          ) FILTER (WHERE up.id IS NOT NULL),
          '[]'
        ) as permissions
      FROM users u
      LEFT JOIN user_permissions up ON u.id = up.user_id
      GROUP BY u.id, u.email, u.is_admin, u.created_at
      ORDER BY u.created_at DESC
    `;

    const result = await pool.query(query);
    return result.rows;
  },

  // Mettre à jour le statut admin d'un utilisateur
  updateAdminStatus: async (userId, isAdmin) => {
    // Protection du super admin
    const userQuery = 'SELECT email FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length > 0 && userResult.rows[0].email === SUPER_ADMIN_EMAIL) {
      throw new Error('Cannot modify super admin status');
    }

    const query = `
      UPDATE users
      SET is_admin = $1
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query(query, [isAdmin, userId]);
    return result.rows[0];
  }
};

module.exports = userPermissionsModel;
