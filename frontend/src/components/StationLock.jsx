import { useContext, useEffect, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { isStation, msUntilCutoff, useIdleLock } from './pda/pdaIdle';

// Chargé au premier verrou seulement : ce composant est dans le socle, l'écran
// de verrouillage entraîne pickingUi.
const PdaLockScreen = lazy(() => import('./pda/PdaLockScreen'));

/**
 * Poste de préparation (ordinateur marqué dans /settings → Gestion
 * utilisateurs) : verrou après inactivité, tous les onglets ensemble, et
 * fermeture de session à 19h30.
 *
 * Au déverrouillage, chaque onglet reste sur sa page : même personne, elle
 * reprend ; autre personne, seul l'utilisateur change (AuthContext suit la
 * session des autres onglets, et chaque appel part avec la session en cours,
 * cf. main.jsx).
 *
 * Les bureaux personnels ne sont jamais marqués : rien ne s'y passe. Les pages
 * /pda ont leur propre verrou (PdaLayout).
 */
export default function StationLock() {
  const { isAuthenticated } = useContext(AuthContext);
  const { pathname } = useLocation();
  if (!isStation() || !isAuthenticated || pathname.startsWith('/pda')) return null;
  return <ActiveStationLock />;
}

function ActiveStationLock() {
  const { user, logout } = useContext(AuthContext);
  const [locked, unlock] = useIdleLock('station');

  useEffect(() => {
    const t = setTimeout(logout, msUntilCutoff());
    return () => clearTimeout(t);
  }, [logout]);

  if (!locked) return null;
  return (
    <Suspense fallback={null}>
      <PdaLockScreen user={user} onUnlock={unlock} title="Poste verrouillé" device="station" />
    </Suspense>
  );
}
