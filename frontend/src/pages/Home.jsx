import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const Home = () => {
  const { user, logout, permissions, isAdmin, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleGoToReviews = () => {
    navigate('/reviews');
  };

  const handleGoToRewards = () => {
    navigate('/rewards');
  };

  const handleGoToEmails = () => {
    navigate('/emails');
  };

  const handleGoToSettings = () => {
    navigate('/settings');
  };

  // Vérifier si l'utilisateur a accès à une app
  const hasAccess = (appName) => {
    if (!permissions) return false;
    return permissions[appName]?.read === true;
  };

  // Compter le nombre d'apps accessibles
  const accessibleAppsCount = permissions
    ? Object.values(permissions).filter(perm => perm.read === true).length
    : 0;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        position: 'relative'
      }}>
        <img
          src="/images/logo.svg"
          alt="YouVape"
          style={{ height: '60px' }}
        />
        {(isAdmin || isSuperAdmin) && (
          <button
            onClick={handleGoToSettings}
            style={{
              position: 'absolute',
              right: '20px',
              padding: '10px 20px',
              backgroundColor: '#fff',
              color: '#135E84',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontWeight: '600'
            }}
          >
            <span>⚙️</span>
            <span>Paramètres</span>
          </button>
        )}
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, maxWidth: '800px', margin: '50px auto', padding: '20px', width: '100%' }}>
        <h1 style={{ textAlign: 'center', color: '#135E84' }}>Bienvenue sur YouVape Apps</h1>
        <p style={{ textAlign: 'center' }}>Connecté en tant que : <strong>{user?.email}</strong></p>

        <div style={{ marginTop: '50px' }}>
          <h2 style={{ textAlign: 'center', color: '#333' }}>Applications disponibles</h2>

          {accessibleAppsCount === 0 ? (
            <div style={{
              marginTop: '30px',
              padding: '30px',
              backgroundColor: '#f8f9fa',
              borderRadius: '8px',
              textAlign: 'center',
              color: '#6c757d'
            }}>
              <p style={{ fontSize: '18px', margin: 0 }}>
                Aucune application accessible. Contactez un administrateur pour obtenir des droits d'accès.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '20px', marginTop: '30px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {hasAccess('reviews') && (
                <div
                  onClick={handleGoToReviews}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '20px 30px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '18px',
                    border: 'none',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span style={{ fontSize: '28px' }}>📱</span>
                  <span>Avis Garantis</span>
                </div>
              )}
              {hasAccess('rewards') && (
                <div
                  onClick={handleGoToRewards}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '20px 30px',
                    backgroundColor: '#8b5cf6',
                    color: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '18px',
                    border: 'none',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span style={{ fontSize: '28px' }}>🎁</span>
                  <span>Récompense Avis</span>
                </div>
              )}
              {hasAccess('emails') && (
                <div
                  onClick={handleGoToEmails}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '20px 30px',
                    backgroundColor: '#28a745',
                    color: 'white',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '18px',
                    border: 'none',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    transition: 'transform 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                >
                  <span style={{ fontSize: '28px' }}>📧</span>
                  <span>Envoi d'Emails</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '50px' }}>
          <button
            onClick={handleLogout}
            style={{
              padding: '12px 30px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              cursor: 'pointer'
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        textAlign: 'center',
        color: 'white'
      }}>
        <p style={{ margin: 0 }}>© 2024 YouVape - Tous droits réservés</p>
      </div>
    </div>
  );
};

export default Home;