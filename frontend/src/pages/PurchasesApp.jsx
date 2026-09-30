import { useState, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { APPS } from '../components/AppIcons';
import { SECTION_KEYS, appOfSection } from '../utils/purchaseSections';
import NeedsTab from '../components/purchases/NeedsTab';
import SuppliersTab from '../components/purchases/SuppliersTab';
import OrdersTab from '../components/purchases/OrdersTab';
import SpendingTab from '../components/purchases/SpendingTab';
import './PurchasesApp.css';

const C = {
  orange: '#E28F00',
  saphir: '#135E84',
  saphirF: '#003A56',
  grisCL: '#E2E2E2',
  grisM: '#8A99A4',
  grisF: '#626E85',
  grisTF: '#2a2e38',
  blanc: '#FFFFFF',
  vert: '#4AB866',
};

// Libellé, icône et couleur de chaque section viennent d'APPS, seule source de
// vérité de l'affichage (cf. l'avertissement de backend/src/config/apps.js) :
// les recopier ici, c'est les voir diverger.
const APP_BY_SECTION = SECTION_KEYS.reduce((m, k) => {
  m[k] = appOfSection(APPS, k);
  return m;
}, {});

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

const PurchasesApp = ({ section = 'besoins' }) => {
  const { token } = useContext(AuthContext);
  const [needsCompact, setNeedsCompact] = useState(false);
  const app = APP_BY_SECTION[section];
  const SectionIcon = app?.Icon;

  return (
    <AppShell currentPath={`/purchases/${section}`}>
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
          {/* L'app, c'est la section. La pile la précède pour situer sans
              répéter : « Achats / Besoins », là où l'en-tête disait
              « Gestion d'achat / Besoins » sous une pile déjà nommée Achats. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: `linear-gradient(155deg, ${app?.color || '#F59E0B'} 0%, ${shade(app?.color || '#F59E0B', -0.2)} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(245,158,11,0.35), 0 1px 0 rgba(255,255,255,0.35) inset',
            }}>
              {SectionIcon && <SectionIcon size={18} color="#fff" />}
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
        <div style={{ flex: 1, padding: section === 'besoins' && needsCompact ? '20px' : '24px 28px' }}>
          {section === 'besoins' && (
            <NeedsTab token={token} onCompactChange={setNeedsCompact} />
          )}
          {section === 'fournisseurs' && (
            <SuppliersTab token={token} />
          )}
          {section === 'commandes' && (
            <OrdersTab token={token} />
          )}
          {section === 'depenses' && (
            <SpendingTab token={token} />
          )}
        </div>
      </main>
    </AppShell>
  );
};

export default PurchasesApp;
