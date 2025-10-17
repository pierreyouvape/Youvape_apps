import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Hook personnalisé pour gérer les permissions
 * @param {string} appName - Nom de l'app (reviews, rewards, emails)
 */
export const usePermissions = (appName) => {
  const { permissions, isSuperAdmin } = useContext(AuthContext);

  // Le super admin a tous les droits
  if (isSuperAdmin) {
    return {
      canRead: true,
      canWrite: true,
      hasAccess: true
    };
  }

  // Vérifier les permissions de l'utilisateur
  const appPermissions = permissions?.[appName];

  return {
    canRead: appPermissions?.read === true,
    canWrite: appPermissions?.write === true,
    hasAccess: appPermissions?.read === true
  };
};
