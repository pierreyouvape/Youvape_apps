import { useContext, useEffect } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { C } from '../picking/pickingUi';
import { pdaBtn } from './pdaStyles';
import { msUntilCutoff, useIdleLock } from './pdaIdle';
import PdaLockScreen from './PdaLockScreen';

/**
 * Cadre commun des pages PDA (/pda et ses apps) : barre du haut, couleur de
 * barre, fermeture de session à 19h30. (Le manifeste « installable » est dans
 * index.html.)
 *
 * La session d'un PDA se ferme tous les soirs à 19h30 (les PDA changent de
 * mains) : le serveur émet le jeton avec cette échéance, et la page, si elle
 * est ouverte, se déconnecte d'elle-même à l'heure dite.
 *
 * Sans activité pendant le délai réglé dans /settings, le PDA se verrouille
 * (pdaIdle, PdaLockScreen) : la page reste ouverte sous le voile.
 */


export default function PdaLayout({ title, onBack, backLabel, children }) {
  const { user, logout } = useContext(AuthContext);
  const [locked, unlock] = useIdleLock('pda');

  // Le manifeste est dans index.html (Chrome doit le trouver sans exécuter la
  // page) ; seule la couleur de barre est propre aux pages PDA.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = C.violet;
    document.head.append(meta);
    return () => { meta.remove(); };
  }, []);

  useEffect(() => {
    const t = setTimeout(logout, msUntilCutoff());
    return () => clearTimeout(t);
  }, [logout]);

  const signOut = () => {
    if (window.confirm(`Se déconnecter ? (${user?.name || user?.email})`)) logout();
  };

  return (
    <div style={{ minHeight: '100vh', background: C.grey, fontFamily: "'Inter', system-ui, sans-serif", color: C.dark }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 20, height: 56, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 12px', background: C.violet, color: C.white,
      }}>
        {onBack
          ? <button onClick={onBack} style={{ ...pdaBtn('rgba(255,255,255,0.18)'), fontSize: 15, padding: '8px 12px' }}>← {backLabel}</button>
          : <span style={{ fontWeight: 900, fontSize: 20 }}>{title}</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 13, opacity: 0.9, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.name || user?.email}
        </span>
        <button onClick={signOut} title="Se déconnecter" style={{ ...pdaBtn('rgba(255,255,255,0.18)'), fontSize: 13, padding: '7px 10px' }}>
          Déconnexion
        </button>
      </div>
      {children}
      {/* Autre personne : rechargement complet, rien de la page précédente ne doit
          survivre (vague, produit ouvert, données chargées avec l'autre compte). */}
      {locked && (
        <PdaLockScreen user={user} onUnlock={unlock} onOtherUser={() => window.location.replace('/pda')} />
      )}
    </div>
  );
}
