import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import './SettingsApp.css';

const SettingsApp = () => {
  const { token, isAdmin, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

  const APPS = [
    { key: 'reviews', label: 'Avis Garantis' },
    { key: 'rewards', label: 'Récompense Avis' },
    { key: 'emails', label: 'Envoi d\'Emails' }
  ];

  useEffect(() => {
    // Vérifier que l'utilisateur est admin
    if (!isAdmin && !isSuperAdmin) {
      navigate('/');
      return;
    }

    loadUsers();
  }, [isAdmin, isSuperAdmin, navigate]);

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Transformer les permissions du format array vers object
      const usersWithPerms = response.data.users.map(user => {
        const perms = {};
        user.permissions.forEach(p => {
          perms[p.app_name] = {
            read: p.can_read,
            write: p.can_write
          };
        });

        // Remplir les apps manquantes avec des droits false
        APPS.forEach(app => {
          if (!perms[app.key]) {
            perms[app.key] = { read: false, write: false };
          }
        });

        return {
          ...user,
          permissions: perms
        };
      });

      setUsers(usersWithPerms);
      setError(null);
    } catch (err) {
      console.error('Erreur lors du chargement des utilisateurs:', err);
      setError('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionChange = (userId, appKey, permType, value) => {
    setUsers(users.map(user => {
      if (user.id === userId) {
        return {
          ...user,
          permissions: {
            ...user.permissions,
            [appKey]: {
              ...user.permissions[appKey],
              [permType]: value
            }
          }
        };
      }
      return user;
    }));
  };

  const handleAdminChange = (userId, value) => {
    setUsers(users.map(user => {
      if (user.id === userId) {
        return { ...user, is_admin: value };
      }
      return user;
    }));
  };

  const saveUserPermissions = async (userId) => {
    try {
      const user = users.find(u => u.id === userId);

      await axios.put(
        `${API_URL}/users/${userId}/permissions`,
        {
          permissions: user.permissions,
          is_admin: user.is_admin
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      setSuccessMessage('Permissions mises à jour avec succès');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      console.error('Erreur lors de la sauvegarde:', err);
      setError(err.response?.data?.error || 'Erreur lors de la sauvegarde');
      setTimeout(() => setError(null), 5000);
    }
  };

  const deleteUser = async (userId, email) => {
    if (!confirm(`Êtes-vous sûr de vouloir supprimer l'utilisateur ${email} ?`)) {
      return;
    }

    try {
      await axios.delete(`${API_URL}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setSuccessMessage('Utilisateur supprimé avec succès');
      setTimeout(() => setSuccessMessage(null), 3000);
      loadUsers();
    } catch (err) {
      console.error('Erreur lors de la suppression:', err);
      setError(err.response?.data?.error || 'Erreur lors de la suppression');
      setTimeout(() => setError(null), 5000);
    }
  };

  const isSuperAdminUser = (email) => {
    return email === 'youvape34@gmail.com';
  };

  if (loading) {
    return (
      <div className="settings-container">
        <div className="loading">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1>Paramètres - Gestion des utilisateurs</h1>
        <button onClick={() => navigate('/home')} className="btn-back">
          ← Retour
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {successMessage && <div className="alert alert-success">{successMessage}</div>}

      <div className="users-table-container">
        <table className="users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Admin</th>
              {APPS.map(app => (
                <th key={app.key} colSpan="2">{app.label}</th>
              ))}
              <th>Actions</th>
            </tr>
            <tr>
              <th></th>
              <th></th>
              {APPS.map(app => (
                <>
                  <th key={`${app.key}-read`} className="sub-header">Lecture</th>
                  <th key={`${app.key}-write`} className="sub-header">Écriture</th>
                </>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map(user => {
              const isSuperAdmin = isSuperAdminUser(user.email);
              return (
                <tr key={user.id} className={isSuperAdmin ? 'super-admin-row' : ''}>
                  <td>
                    {user.email}
                    {isSuperAdmin && <span className="badge-super-admin">Super Admin</span>}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={user.is_admin}
                      onChange={(e) => handleAdminChange(user.id, e.target.checked)}
                      disabled={isSuperAdmin}
                    />
                  </td>
                  {APPS.map(app => (
                    <>
                      <td key={`${app.key}-read`} className="permissions-cell">
                        <input
                          type="checkbox"
                          checked={user.permissions[app.key]?.read || false}
                          onChange={(e) => handlePermissionChange(user.id, app.key, 'read', e.target.checked)}
                          disabled={isSuperAdmin}
                        />
                      </td>
                      <td key={`${app.key}-write`} className="permissions-cell">
                        <input
                          type="checkbox"
                          checked={user.permissions[app.key]?.write || false}
                          onChange={(e) => handlePermissionChange(user.id, app.key, 'write', e.target.checked)}
                          disabled={isSuperAdmin}
                        />
                      </td>
                    </>
                  ))}
                  <td className="actions-cell">
                    <button
                      onClick={() => saveUserPermissions(user.id)}
                      className="btn btn-save"
                      disabled={isSuperAdmin}
                    >
                      Sauvegarder
                    </button>
                    {!isSuperAdmin && (
                      <button
                        onClick={() => deleteUser(user.id, user.email)}
                        className="btn btn-delete"
                      >
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {users.length === 0 && (
        <div className="no-users">Aucun utilisateur trouvé</div>
      )}
    </div>
  );
};

export default SettingsApp;
