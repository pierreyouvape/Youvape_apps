import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { APPS } from '../components/AppIcons';
import NeedsTabV2 from '../components/purchases/NeedsTabV2';
import './PurchasesApp.css';

/**
 * Besoins V2 — le calcul des besoins en cours d'essai, à côté du V1.
 *
 * Cette page était une COPIE COMPLÈTE de l'ancienne Gestion d'achat : elle
 * portait les quatre onglets dans un menu interne, alors que trois d'entre eux
 * (Fournisseurs, Commandes, Dépenses) rendaient exactement les mêmes composants
 * que le V1. Depuis que ces trois-là sont des apps de la pile Achats, les
 * rouvrir ici ramenait l'ancienne présentation sous un autre nom, et donnait
 * deux chemins vers un écran identique.
 *
 * Ne reste donc que ce qui distingue vraiment le V2 : NeedsTabV2, qui découple
 * le seuil d'alerte de la couverture. Le jour où il remplace le V1, c'est
 * l'entrée `purchases` d'APPS qui pointera ici, et cette page disparaîtra.
 */
const C = {
  grisCL: '#E2E2E2',
  grisM: '#8A99A4',
  grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

const PurchasesAppV2 = () => {
  const { token } = useContext(AuthContext);
  const [needsCompact, setNeedsCompact] = useState(false);

  // Libellé, icône et couleur viennent d'APPS, comme pour les autres apps de la
  // pile : les recopier ici, c'est les voir diverger.
  const app = APPS.find(a => a.path === '/purchases-v2');
  const AppIcon = app?.Icon;
  const couleur = app?.color || '#D97706';

  return (
    <AppShell currentPath="/purchases-v2">
      <main
        className="main-scroll"
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Top bar */}
        <header style={{
          background: C.blanc,
          borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 28px',
          minHeight: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, zIndex: 20,
          gap: 16, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: `linear-gradient(155deg, ${couleur} 0%, ${shade(couleur, -0.2)} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(217,119,6,0.35), 0 1px 0 rgba(255,255,255,0.35) inset',
            }}>
              {AppIcon && <AppIcon size={18} color="#fff" />}
            </div>
            <div style={{ fontSize: 13, color: C.grisM, fontWeight: 600 }}>Achats</div>
            <span style={{ color: C.grisCL }}>/</span>
            <div style={{
              fontSize: 16, fontWeight: 800, color: C.grisTF,
              fontFamily: "'Tilt Warp', cursive",
            }}>
              {app?.label}
            </div>
          </div>
        </header>

        {/* Contenu */}
        <div style={{ flex: 1, padding: needsCompact ? '20px' : '24px 28px' }}>
          <NeedsTabV2 token={token} onCompactChange={setNeedsCompact} />
        </div>
      </main>
    </AppShell>
  );
};

export default PurchasesAppV2;
