import { useRef } from 'react';
import { C } from '../picking/pickingUi';
import PdaSignIn from './PdaSignIn';

/**
 * PDA verrouillé après inactivité (usePdaIdleLock). La page reste ouverte
 * dessous, intacte :
 *   - la même personne se reconnecte → on retire le voile, elle reprend où elle était ;
 *   - quelqu'un d'autre → sa session remplace la précédente, retour à l'accueil.
 *     Rechargement complet : rien de la page précédente ne doit survivre
 *     (vague, produit ouvert, données chargées avec l'autre compte).
 */
export default function PdaLockScreen({ user, onUnlock }) {
  // Figé à l'ouverture du verrou : la connexion va remplacer `user` dans le contexte.
  const lockedUserId = useRef(user?.id);

  const onSignedIn = (data) => {
    if (data?.user?.id === lockedUserId.current) onUnlock();
    else window.location.replace('/pda');
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: C.grey, overflowY: 'auto',
      fontFamily: "'Inter', system-ui, sans-serif", color: C.dark,
    }}>
      <div style={{
        height: 56, display: 'flex', alignItems: 'center', padding: '0 12px',
        background: C.violet, color: C.white, fontWeight: 900, fontSize: 20,
      }}>
        PDA verrouillé
      </div>
      <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
        <div style={{
          background: C.white, width: '100%', maxWidth: 420, padding: 20, borderRadius: 12,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)', boxSizing: 'border-box',
        }}>
          {user && (
            <p style={{ margin: '0 0 16px', textAlign: 'center', fontSize: 14, color: C.greyT }}>
              Session en cours : <strong>{user.name || user.email}</strong>
            </p>
          )}
          <PdaSignIn capture onSignedIn={onSignedIn} />
        </div>
      </div>
    </div>
  );
}
