import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import axios from 'axios';
import './SettingsApp.css';
import { LinkBox } from '../utils/navHelpers';
import AppShell from '../components/AppShell';
import { APPS as LAUNCHER_APPS } from '../components/AppIcons';

// Apps qui distinguent Lecture / Écriture (les autres n'ont qu'un droit d'accès).
// Réception : Lecture = consulter les PO attendus ; Écriture = valider une
// réception (écrit dans BMS).
const WRITE_ENABLED_KEYS = new Set(['reviews', 'rewards', 'emails', 'stats', 'purchases', 'catalog', 'reception', 'stats-boutiques']);

// Apps dont les deux cases sont des NIVEAUX, pas Lecture / Écriture : la
// seconde inclut la première (cocher Responsable coche Conseiller, décocher
// Conseiller décoche Responsable).
const LEVEL_LABELS = { 'stats-boutiques': ['Conseiller', 'Responsable'] };

// Droits qui ne sont PAS une app du lanceur : ils ouvrent une section à
// l'intérieur d'une autre app. « Stats boutiques » = la tuile Statistiques des
// apps Boutique (backend/src/config/apps.js la connaît aussi).
const EXTRA_PERMISSIONS = [{ key: 'stats-boutiques', label: 'Stats boutiques' }];

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
  // Empreinte des droits tels qu'ils sont en base : sert à savoir quelles
  // lignes ont été touchées depuis le dernier chargement / enregistrement.
  const [savedSignatures, setSavedSignatures] = useState({});
  const [savingAll, setSavingAll] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [justSavedIds, setJustSavedIds] = useState([]);

  // Onglet WooCommerce
  const [wcSyncInterval, setWcSyncInterval] = useState('');
  const [savingSync, setSavingSync] = useState(false);

  // Messages globaux
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState(null);

  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

  // Dérivé de la liste canonique des apps (composants/AppIcons) : toute nouvelle
  // app ajoutée au lanceur apparaît AUTOMATIQUEMENT ici, gérable par utilisateur.
  //
  // Sauf celles qui s'ouvrent avec le droit d'une autre (`permissionKey`) : leur
  // colonne serait une case à cocher sans effet, et cocher deux cases pour une
  // seule autorisation finit toujours par en laisser une de côté. Elles sont
  // nommées dans l'infobulle de l'app qui porte le droit, pour qu'on sache ce
  // qu'on ouvre vraiment.
  const sharedBy = LAUNCHER_APPS.reduce((m, a) => {
    if (!a.permissionKey) return m;
    (m[a.permissionKey] = m[a.permissionKey] || []).push(a.label);
    return m;
  }, {});

  const APPS = [...LAUNCHER_APPS.filter(a => !a.permissionKey), ...EXTRA_PERMISSIONS].map(a => ({
    key: a.key,
    label: a.label,
    accessOnly: !WRITE_ENABLED_KEYS.has(a.key),
    levels: LEVEL_LABELS[a.key] || null,
    alsoOpens: sharedBy[a.key] || null,
  }));

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
      setSavedSignatures(Object.fromEntries(usersWithPerms.map(u => [u.id, userSignature(u)])));
      setJustSavedIds([]);
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
              [permType]: value,
              ...(LEVEL_LABELS[appKey] && permType === 'write' && value ? { read: true } : {}),
              ...(LEVEL_LABELS[appKey] && permType === 'read' && !value ? { write: false } : {}),
            }
          }
        };
      }
      return user;
    }));
  };

  // Apps à droit unique : la case « Accès » pose lecture ET écriture.
  const handleAccessChange = (userId, appKey, value) => {
    setUsers(prev => prev.map(u => u.id === userId ? {
      ...u,
      permissions: { ...u.permissions, [appKey]: { read: value, write: value } }
    } : u));
  };

  const handleAdminChange = (userId, value) => {
    setUsers(users.map(user => {
      if (user.id === userId) {
        return { ...user, is_admin: value };
      }
      return user;
    }));
  };

  const isSuperAdminUser = (email) => {
    return email === 'youvape34@gmail.com';
  };

  // Un utilisateur = une colonne : le super admin et les colonnes modifiées
  // non enregistrées se repèrent sur toute leur hauteur.
  const userColClass = (user, isDirty, base = '') => [
    base,
    isSuperAdminUser(user.email) ? 'super-admin-col' : '',
    isDirty ? 'col-dirty' : '',
  ].filter(Boolean).join(' ');

  // Empreinte stable d'une ligne (ordre des clés figé par APPS) : deux lignes
  // identiques donnent la même chaîne, quel que soit l'ordre d'arrivée des droits.
  const userSignature = (user) => JSON.stringify([
    user.is_admin ? 1 : 0,
    ...APPS.map(app => `${user.permissions[app.key]?.read ? 1 : 0}${user.permissions[app.key]?.write ? 1 : 0}`)
  ]);

  const dirtyUsers = users.filter(u => {
    const ref = savedSignatures[u.id];
    return ref !== undefined && ref !== userSignature(u) && !isSuperAdminUser(u.email);
  });
  const dirtyIds = dirtyUsers.map(u => u.id);

  // Plus de sauvegarde ligne par ligne : on prévient avant de quitter la page
  // avec des cases cochées mais non enregistrées.
  useEffect(() => {
    if (dirtyIds.length === 0) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtyIds.length]);

  const saveAllPermissions = async () => {
    if (dirtyUsers.length === 0) return;
    setSavingAll(true);
    setError(null);
    setSuccessMessage(null);

    const results = await Promise.all(dirtyUsers.map(async (user) => {
      try {
        await axios.put(
          `${API_URL}/users/${user.id}/permissions`,
          { permissions: user.permissions, is_admin: user.is_admin },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        return { user, ok: true };
      } catch (err) {
        console.error(`Erreur lors de la sauvegarde de ${user.email}:`, err);
        return { user, ok: false, err };
      }
    }));

    const saved = results.filter(r => r.ok);
    const failed = results.filter(r => !r.ok);

    // On ne remet à jour l'empreinte que des lignes réellement enregistrées :
    // celles qui ont échoué restent marquées comme modifiées.
    if (saved.length > 0) {
      setSavedSignatures(prev => {
        const next = { ...prev };
        saved.forEach(({ user }) => { next[user.id] = userSignature(user); });
        return next;
      });
      setLastSavedAt(new Date());
      setJustSavedIds(saved.map(({ user }) => user.id));
      setTimeout(() => setJustSavedIds([]), 4000);
    }

    if (failed.length === 0) {
      setSuccessMessage(
        saved.length > 1
          ? `${saved.length} utilisateurs enregistrés avec succès`
          : 'Utilisateur enregistré avec succès'
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } else {
      setError(
        `Échec de l'enregistrement pour : ${failed.map(f => f.user.email).join(', ')}`
        + (failed[0].err?.response?.data?.error ? ` (${failed[0].err.response.data.error})` : '')
      );
      setTimeout(() => setError(null), 8000);
    }

    setSavingAll(false);
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

  return (
    <AppShell currentPath="/settings">
    <main className="main-scroll settings-app" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh' }}>
      <header className="settings-header-bar">
        <LinkBox to="/home" display="inline-block" className="settings-back-button">
          ← Accueil
        </LinkBox>
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
                        <th className="perm-label">Droit</th>
                        {users.map(user => {
                          const isSuperAdm = isSuperAdminUser(user.email);
                          const isDirty = dirtyIds.includes(user.id);
                          const isJustSaved = justSavedIds.includes(user.id);
                          return (
                            <th key={user.id} className={userColClass(user, isDirty)}>
                              <span className="user-col-email">{user.email}</span>
                              {isSuperAdm && <span className="badge-super-admin">Super Admin</span>}
                              {isDirty && <span className="badge-dirty">Modifié</span>}
                              {isJustSaved && <span className="badge-saved">Enregistré</span>}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="perm-group-end">
                        <td className="perm-label"><div className="perm-label-inner"><span className="perm-app">Admin</span></div></td>
                        {users.map(user => (
                          <td key={user.id} className={userColClass(user, dirtyIds.includes(user.id), 'permissions-cell')}>
                            <input
                              type="checkbox"
                              checked={user.is_admin}
                              onChange={(e) => handleAdminChange(user.id, e.target.checked)}
                              disabled={isSuperAdminUser(user.email)}
                            />
                          </td>
                        ))}
                      </tr>
                      {APPS.flatMap(app => {
                        // Une ligne « Accès » pour les apps sans distinction, sinon
                        // deux lignes Lecture / Écriture (ou les deux niveaux).
                        const rows = app.accessOnly
                          ? [['access', 'Accès']]
                          : [['read', app.levels ? app.levels[0] : 'Lecture'], ['write', app.levels ? app.levels[1] : 'Écriture']];
                        return rows.map(([permType, subLabel], i) => (
                          <tr key={`${app.key}-${permType}`} className={i === rows.length - 1 ? 'perm-group-end' : undefined}>
                            <td
                              className="perm-label"
                              title={app.alsoOpens ? `Donne aussi accès à : ${app.alsoOpens.join(', ')}` : undefined}
                            >
                              <div className="perm-label-inner">
                                <span className={i === 0 ? 'perm-app' : 'perm-app perm-app-repeat'}>
                                  {app.label}
                                  {i === 0 && app.alsoOpens && <span className="perm-shared">+ {app.alsoOpens.join(', ')}</span>}
                                </span>
                                <span className="perm-sub">{subLabel}</span>
                              </div>
                            </td>
                            {users.map(user => (
                              <td key={user.id} className={userColClass(user, dirtyIds.includes(user.id), 'permissions-cell')}>
                                <input
                                  type="checkbox"
                                  checked={user.permissions[app.key]?.[permType === 'access' ? 'read' : permType] || false}
                                  onChange={(e) => permType === 'access'
                                    ? handleAccessChange(user.id, app.key, e.target.checked)
                                    : handlePermissionChange(user.id, app.key, permType, e.target.checked)}
                                  disabled={isSuperAdminUser(user.email)}
                                />
                              </td>
                            ))}
                          </tr>
                        ));
                      })}
                      <tr className="perm-group-end">
                        <td className="perm-label"><div className="perm-label-inner"><span className="perm-app">Actions</span></div></td>
                        {users.map(user => (
                          <td key={user.id} className={userColClass(user, dirtyIds.includes(user.id), 'actions-cell')}>
                            {!isSuperAdminUser(user.email) && (
                              <button
                                onClick={() => deleteUser(user.id, user.email)}
                                className="btn btn-delete"
                              >
                                Supprimer
                              </button>
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div className="users-save-bar">
                  <div className="users-save-status">
                    {dirtyIds.length > 0 ? (
                      <span className="status-dirty">
                        {dirtyIds.length} utilisateur{dirtyIds.length > 1 ? 's' : ''} modifié{dirtyIds.length > 1 ? 's' : ''} non enregistré{dirtyIds.length > 1 ? 's' : ''}
                      </span>
                    ) : lastSavedAt ? (
                      <span className="status-saved">
                        ✓ Enregistré à {lastSavedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    ) : (
                      <span className="status-idle">Aucune modification en attente</span>
                    )}
                  </div>
                  <button
                    onClick={saveAllPermissions}
                    className="btn btn-save btn-save-all"
                    disabled={savingAll || dirtyIds.length === 0}
                  >
                    {savingAll ? 'Enregistrement...' : 'Tout enregistrer'}
                  </button>
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
    </main>
    </AppShell>
  );
};

export default SettingsApp;
