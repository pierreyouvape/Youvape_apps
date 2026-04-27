import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import './SettingsApp.css';

const SettingsApp = () => {
  const { token, isAdmin, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState('account');

  // Onglet Mon compte
  const [bmsPassword, setBmsPassword] = useState('');
  const [savingBmsPassword, setSavingBmsPassword] = useState(false);

  // Onglet Gestion utilisateurs
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Onglet WooCommerce
  const [wcSyncInterval, setWcSyncInterval] = useState('');
  const [savingSync, setSavingSync] = useState(false);

  // Messages globaux
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

  const APPS = [
    { key: 'reviews', label: 'Avis Garantis' },
    { key: 'rewards', label: 'Récompense Avis' },
    { key: 'emails', label: 'Envoi d\'Emails' },
    { key: 'stats', label: 'Statistiques WooCommerce' },
    { key: 'purchases', label: 'Gestion d\'achat' },
    { key: 'catalog', label: 'Produits' },
    { key: 'packing', label: 'Packing', accessOnly: true },
    { key: 'financier', label: 'Dashboard Financier', accessOnly: true }
  ];

  const tabs = [
    { id: 'account', label: 'Mon compte' },
    ...(isAdmin || isSuperAdmin ? [
      { id: 'users', label: 'Gestion utilisateurs' },
      { id: 'woocommerce', label: 'Paramètres WooCommerce' }
    ] : [])
  ];

  // Chargement lazy : utilisateurs
  useEffect(() => {
    if (activeTab === 'users' && (isAdmin || isSuperAdmin) && users.length === 0) {
      loadUsers();
    }
  }, [activeTab]);

  // Chargement lazy : settings WC
  useEffect(() => {
    if (activeTab === 'woocommerce' && (isAdmin || isSuperAdmin) && wcSyncInterval === '') {
      loadSettings();
    }
  }, [activeTab]);

  const loadSettings = async () => {
    try {
      const response = await axios.get(`${API_URL}/settings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.data.success) {
        setWcSyncInterval(response.data.settings.wc_sync_interval || '0');
      }
    } catch (err) {
      console.error('Erreur lors du chargement des paramètres:', err);
    }
  };

  const saveWcSyncInterval = async () => {
    setSavingSync(true);
    try {
      await axios.put(
        `${API_URL}/settings/wc_sync_interval`,
        { value: wcSyncInterval },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccessMessage('Intervalle de sync WC mis à jour');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Erreur lors de la sauvegarde');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSavingSync(false);
    }
  };

  const saveBmsPassword = async () => {
    setSavingBmsPassword(true);
    try {
      await axios.put(
        `${API_URL}/users/me/bms-password`,
        { bms_password: bmsPassword },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSuccessMessage('Mot de passe BMS mis à jour');
      setBmsPassword('');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('Erreur lors de la sauvegarde');
      setTimeout(() => setError(null), 5000);
    } finally {
      setSavingBmsPassword(false);
    }
  };

  const loadUsers = async () => {
    try {
      setLoadingUsers(true);
      const response = await axios.get(`${API_URL}/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const usersWithPerms = response.data.users.map(user => {
        const perms = {};
        user.permissions.forEach(p => {
          perms[p.app_name] = {
            read: p.can_read,
            write: p.can_write
          };
        });

        APPS.forEach(app => {
          if (!perms[app.key]) {
            perms[app.key] = { read: false, write: false };
          }
        });

        return { ...user, permissions: perms };
      });

      setUsers(usersWithPerms);
      setError(null);
    } catch (err) {
      console.error('Erreur lors du chargement des utilisateurs:', err);
      setError('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoadingUsers(false);
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
        { headers: { Authorization: `Bearer ${token}` } }
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

  return (
    <div className="settings-app">
      <header className="settings-header-bar">
        <button className="settings-back-button" onClick={() => navigate('/home')}>
          ← Accueil
        </button>
        <h1>Paramètres</h1>
      </header>

      <nav className="settings-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="settings-content">
        {error && <div className="alert alert-error">{error}</div>}
        {successMessage && <div className="alert alert-success">{successMessage}</div>}

        {/* Onglet Mon compte */}
        {activeTab === 'account' && (
          <div className="settings-section">
            <h2>Mon compte</h2>
            <div className="account-field">
              <label>Mot de passe BMS</label>
              <div className="account-field-row">
                <input
                  type="password"
                  value={bmsPassword}
                  onChange={(e) => setBmsPassword(e.target.value)}
                  placeholder="Nouveau mot de passe BMS"
                  className="settings-input"
                />
                <button
                  onClick={saveBmsPassword}
                  disabled={savingBmsPassword || !bmsPassword}
                  className="btn btn-save"
                >
                  {savingBmsPassword ? 'Mise à jour...' : 'Mettre à jour'}
                </button>
              </div>
              <p className="field-hint">
                Ce mot de passe est utilisé pour l'authentification à l'API BMS (avec votre email de connexion).
              </p>
            </div>
          </div>
        )}

        {/* Onglet Gestion utilisateurs */}
        {activeTab === 'users' && (isAdmin || isSuperAdmin) && (
          <div className="settings-section">
            <h2>Gestion des utilisateurs</h2>
            {loadingUsers ? (
              <div className="loading">Chargement...</div>
            ) : (
              <>
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
                          app.accessOnly ? (
                            <th key={`${app.key}-access`} className="sub-header" colSpan="2">Accès</th>
                          ) : (
                            <>
                              <th key={`${app.key}-read`} className="sub-header">Lecture</th>
                              <th key={`${app.key}-write`} className="sub-header">Écriture</th>
                            </>
                          )
                        ))}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(user => {
                        const isSuperAdm = isSuperAdminUser(user.email);
                        return (
                          <tr key={user.id} className={isSuperAdm ? 'super-admin-row' : ''}>
                            <td>
                              {user.email}
                              {isSuperAdm && <span className="badge-super-admin">Super Admin</span>}
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={user.is_admin}
                                onChange={(e) => handleAdminChange(user.id, e.target.checked)}
                                disabled={isSuperAdm}
                              />
                            </td>
                            {APPS.map(app => (
                              app.accessOnly ? (
                                <td key={`${app.key}-access`} className="permissions-cell" colSpan="2" style={{ textAlign: 'center' }}>
                                  <input
                                    type="checkbox"
                                    checked={user.permissions[app.key]?.read || false}
                                    onChange={(e) => {
                                      const val = e.target.checked;
                                      setUsers(prev => prev.map(u => u.id === user.id ? {
                                        ...u,
                                        permissions: {
                                          ...u.permissions,
                                          [app.key]: { read: val, write: val }
                                        }
                                      } : u));
                                    }}
                                    disabled={isSuperAdm}
                                  />
                                </td>
                              ) : (
                                <>
                                  <td key={`${app.key}-read`} className="permissions-cell">
                                    <input
                                      type="checkbox"
                                      checked={user.permissions[app.key]?.read || false}
                                      onChange={(e) => handlePermissionChange(user.id, app.key, 'read', e.target.checked)}
                                      disabled={isSuperAdm}
                                    />
                                  </td>
                                  <td key={`${app.key}-write`} className="permissions-cell">
                                    <input
                                      type="checkbox"
                                      checked={user.permissions[app.key]?.write || false}
                                      onChange={(e) => handlePermissionChange(user.id, app.key, 'write', e.target.checked)}
                                      disabled={isSuperAdm}
                                    />
                                  </td>
                                </>
                              )
                            ))}
                            <td className="actions-cell">
                              <button
                                onClick={() => saveUserPermissions(user.id)}
                                className="btn btn-save"
                                disabled={isSuperAdm}
                              >
                                Sauvegarder
                              </button>
                              {!isSuperAdm && (
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
              </>
            )}
          </div>
        )}

        {/* Onglet Paramètres WooCommerce */}
        {activeTab === 'woocommerce' && (isAdmin || isSuperAdmin) && (
          <div className="settings-section">
            <h2>Synchronisation WooCommerce</h2>
            <div className="wc-sync-row">
              <label style={{ fontWeight: '500' }}>Sync WC toutes les</label>
              <input
                type="number"
                min="0"
                value={wcSyncInterval}
                onChange={(e) => setWcSyncInterval(e.target.value)}
                className="settings-input settings-input-short"
              />
              <span>secondes</span>
              <button
                onClick={saveWcSyncInterval}
                disabled={savingSync}
                className="btn btn-save"
              >
                {savingSync ? 'Sauvegarde...' : 'Sauvegarder'}
              </button>
            </div>
            <p className="field-hint">
              0 = désactivé. Le backend poll WordPress à cet intervalle pour récupérer les modifications.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsApp;
