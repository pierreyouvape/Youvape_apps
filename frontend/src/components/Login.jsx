import CloudLogo from './CloudLogo';
import { useState, useContext, useCallback, useRef, lazy, Suspense } from 'react';
import { AuthContext } from '../context/AuthContext';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { beep, useScanner } from './pda/pdaScan';

// Chargé au toucher du bouton seulement : l'écran de connexion est dans le socle.
const CameraScanner = lazy(() => import('./boutique/CameraScanner'));

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [camera, setCamera] = useState(false);

  const { login, loginWithBadge } = useContext(AuthContext);
  const navigate = useNavigate();
  const location = useLocation();

  // Venu d'une page PDA : on peut aussi se connecter en scannant son badge employé.
  const from = location.state?.from || '';
  const isPda = from.startsWith('/pda');

  const handleBadge = async (code) => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await loginWithBadge(code);
      beep(true);
      navigate(from);
    } catch (err) {
      beep(false);
      setError(err.response?.data?.error || 'Erreur lors de la connexion');
    } finally {
      setLoading(false);
    }
  };

  useScanner(handleBadge, isPda && !camera);

  // Smartphone sans douchette : le badge se lit à l'appareil photo.
  // (Rappel stable : CameraScanner relance la caméra si on le change.)
  const badgeRef = useRef(handleBadge);
  badgeRef.current = handleBadge;
  const onCameraCode = useCallback((code) => {
    setCamera(false);
    badgeRef.current(code);
  }, []);
  const closeCamera = useCallback(() => setCamera(false), []);
  const canCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  // Scan tombé dans le champ Email (curseur dedans) : c'est quand même un badge.
  const onEmailKeyDown = (e) => {
    if (isPda && e.key === 'Enter' && /^\d{13}$/.test(email.trim())) {
      e.preventDefault();
      const code = email.trim();
      setEmail('');
      handleBadge(code);
    }
  };

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!validateEmail(email)) {
      setError('Email invalide');
      return;
    }

    if (password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères');
      return;
    }

    setLoading(true);
    try {
      // Venu d'une page PDA : connexion PDA, fermée ce soir 19h30.
      await login(email, password, rememberMe, isPda ? 'pda' : null);
      navigate(from || '/home');
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: '#f5f5f5' }}>
      {/* Header */}
      <div style={{
        backgroundColor: '#135E84',
        padding: '20px 0',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <CloudLogo />
      </div>

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
        <div style={{
          backgroundColor: 'white',
          maxWidth: '400px',
          width: '100%',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
        }}>
          <h2 style={{ textAlign: 'center', color: '#135E84', marginBottom: '30px' }}>Connexion</h2>
          {isPda && (
            <>
              <div style={{
                border: '2px dashed #135E84',
                borderRadius: '8px',
                padding: '18px',
                textAlign: 'center',
                color: '#135E84',
                backgroundColor: '#EEF5F9'
              }}>
                <div style={{ fontSize: '18px', fontWeight: 'bold' }}>
                  {loading ? 'Connexion…' : 'Scannez votre badge'}
                </div>
                <div style={{ fontSize: '13px', color: '#555', marginTop: '6px' }}>
                  Le code-barres à votre nom, sans rien toucher à l'écran
                </div>
                {canCamera && (
                  <button
                    type="button"
                    onClick={() => setCamera(true)}
                    disabled={loading}
                    style={{
                      marginTop: '14px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '10px 16px',
                      backgroundColor: 'white',
                      color: '#135E84',
                      border: '1px solid #135E84',
                      borderRadius: '6px',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
                      <circle cx="12" cy="13" r="3.5" />
                    </svg>
                    Scanner avec l'appareil photo
                  </button>
                )}
              </div>
              {camera && (
                <Suspense fallback={null}>
                  <CameraScanner onDetect={onCameraCode} onClose={closeCamera} />
                </Suspense>
              )}
              <div style={{ textAlign: 'center', color: '#999', fontSize: '13px', margin: '18px 0' }}>
                ou avec vos identifiants
              </div>
            </>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '15px' }}>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={onEmailKeyDown}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '16px'
                }}
                required
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <input
                type="password"
                placeholder="Mot de passe"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '16px'
                }}
                required
              />
            </div>
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: '#555' }}>
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Maintenir la connexion
              </label>
            </div>
            {error && <div style={{ color: 'red', marginBottom: '15px', textAlign: 'center' }}>{error}</div>}
            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '12px',
                backgroundColor: '#135E84',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '16px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              {loading ? 'Chargement...' : 'Se connecter'}
            </button>
          </form>
          <p style={{ marginTop: '20px', textAlign: 'center' }}>
            Pas de compte ? <Link to="/register" style={{ color: '#135E84', fontWeight: 'bold' }}>S'inscrire</Link>
          </p>
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

export default Login;