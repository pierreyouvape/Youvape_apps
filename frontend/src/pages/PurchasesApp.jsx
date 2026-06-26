import { useState, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Purchases as PurchasesIcon } from '../components/AppIcons';
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

const SECTIONS = [
  { key: 'besoins',      label: 'Besoins',       icon: '📊' },
  { key: 'fournisseurs', label: 'Fournisseurs',   icon: '🏭' },
  { key: 'commandes',    label: 'Commandes',      icon: '📦' },
  { key: 'depenses',     label: 'Dépenses',       icon: '💶' },
];

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

const PurchasesApp = () => {
  const { token } = useContext(AuthContext);
  const [section, setSection] = useState('besoins');
  const [needsCompact, setNeedsCompact] = useState(false);

  /* Menu interne injecté dans la sidebar */
  const appMenu = (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
        color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase',
        padding: '4px 10px 10px',
      }}>
        Gestion d'achat
      </div>
      <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {SECTIONS.map(s => {
          const active = section === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 10,
                background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: active ? '#fff' : 'rgba(255,255,255,0.72)',
                border: 'none',
                borderLeft: active ? `3px solid ${C.orange}` : '3px solid transparent',
                borderRadius: 8,
                padding: active ? '8px 12px 8px 9px' : '8px 12px',
                fontSize: 13, fontWeight: active ? 700 : 500,
                cursor: 'pointer', fontFamily: 'inherit',
                transition: 'background 0.15s, color 0.15s',
                width: '100%',
              }}
              onMouseEnter={e => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'rgba(255,255,255,0.92)'; } }}
              onMouseLeave={e => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.72)'; } }}
            >
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <AppShell appMenu={appMenu} currentPath="/purchases">
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
              background: `linear-gradient(155deg, #F59E0B 0%, ${shade('#F59E0B', -0.2)} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(245,158,11,0.35), 0 1px 0 rgba(255,255,255,0.35) inset',
            }}>
              <PurchasesIcon size={18} color="#fff" />
            </div>
            <div style={{
              fontSize: 16, fontWeight: 800, color: C.grisTF,
              fontFamily: "'Tilt Warp', cursive",
            }}>
              Gestion d'achat
            </div>
            <span style={{ color: C.grisCL }}>/</span>
            <span style={{ fontSize: 13, color: C.grisF, fontWeight: 600 }}>
              {SECTIONS.find(s => s.key === section)?.label}
            </span>
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
