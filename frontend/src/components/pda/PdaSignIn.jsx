import { useCallback, useContext, useEffect, useRef, useState, lazy, Suspense } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { beep } from './pdaScan';
import { markActive } from './pdaIdle';

// Chargé au toucher du bouton seulement : l'écran de connexion est dans le socle.
const CameraScanner = lazy(() => import('../boutique/CameraScanner'));

const BLUE = '#135E84';
const field = { width: '100%', padding: '12px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '16px', boxSizing: 'border-box' };
const isBadge = (s) => /^\d{13}$/.test(s);

/**
 * Connexion d'un appareil partagé — PDA ou poste de préparation : badge employé
 * (douchette ou appareil photo) ou identifiants. Session fermée à 19h30 dans
 * tous les cas.
 *
 * Sert à l'écran de connexion (venu d'une page /pda, ou sur un poste de
 * préparation) et à l'écran de verrouillage (PdaLockScreen). Là, `capture` : la page reste ouverte dessous avec son propre
 * lecteur de scans, le badge ne doit pas lui parvenir (le Picking le prendrait
 * pour un article). On écoute donc avant tout le monde et on arrête la touche.
 *
 * @param {(data: {token, user}) => void} onSignedIn  session ouverte
 * @param {'pda'|'station'} device
 */
export default function PdaSignIn({ onSignedIn, capture = false, device = 'pda' }) {
  const { login, loginWithBadge } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [camera, setCamera] = useState(false);

  const signIn = async (call) => {
    setError('');
    setLoading(true);
    try {
      const data = await call();
      beep(true);
      markActive(device);
      onSignedIn(data);
    } catch (err) {
      beep(false);
      setError(err.response?.data?.error || 'Erreur lors de la connexion');
    } finally {
      setLoading(false);
    }
  };

  const badgeRef = useRef(null);
  badgeRef.current = (code) => { if (!loading) signIn(() => loginWithBadge(code)); };

  // Lecteur « clavier » (caractères rapides puis Entrée), comme useScanner, mais
  // en phase de capture pour passer devant les lecteurs de la page.
  useEffect(() => {
    if (camera) return undefined;
    let buffer = '';
    let last = 0;
    const onKey = (e) => {
      if (capture) e.stopPropagation();
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const now = Date.now();
      if (now - last > 300) buffer = '';
      last = now;
      if (e.key === 'Enter') {
        const code = buffer.trim();
        buffer = '';
        if (code.length >= 3) badgeRef.current(code);
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [camera, capture]);

  // (Rappel stable : CameraScanner relance la caméra si on le change.)
  const onCameraCode = useCallback((code) => {
    setCamera(false);
    badgeRef.current(code);
  }, []);
  const closeCamera = useCallback(() => setCamera(false), []);
  const canCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  const handleSubmit = (e) => {
    e.preventDefault();
    // Scan tombé dans le champ Email (curseur dedans) : c'est quand même un badge.
    if (isBadge(email.trim())) {
      const code = email.trim();
      setEmail('');
      badgeRef.current(code);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Email invalide');
    if (password.length < 6) return setError('Le mot de passe doit contenir au moins 6 caractères');
    signIn(() => login(email, password, false, device));
  };

  return (
    <>
      <div style={{
        border: `2px dashed ${BLUE}`, borderRadius: '8px', padding: '18px',
        textAlign: 'center', color: BLUE, backgroundColor: '#EEF5F9'
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
              marginTop: '14px', display: 'inline-flex', alignItems: 'center', gap: '8px',
              padding: '10px 16px', backgroundColor: 'white', color: BLUE, border: `1px solid ${BLUE}`,
              borderRadius: '6px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'
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

      {/* noValidate : un badge scanné dans le champ Email n'est pas une adresse valide. */}
      <form onSubmit={handleSubmit} noValidate>
        <input
          type="email" placeholder="Email" value={email} autoComplete="username"
          onChange={(e) => setEmail(e.target.value)} style={{ ...field, marginBottom: '15px' }}
        />
        <input
          type="password" placeholder="Mot de passe" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)} style={{ ...field, marginBottom: '15px' }}
        />
        {error && <div style={{ color: 'red', marginBottom: '15px', textAlign: 'center' }}>{error}</div>}
        <button
          type="submit" disabled={loading}
          style={{
            width: '100%', padding: '12px', backgroundColor: BLUE, color: 'white', border: 'none',
            borderRadius: '4px', fontSize: '16px', cursor: 'pointer', fontWeight: 'bold'
          }}
        >
          {loading ? 'Chargement...' : 'Se connecter'}
        </button>
      </form>
    </>
  );
}
