import { useContext, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import DailyOrdersTab from '../components/atb/DailyOrdersTab';

/* ─── PALETTE (alignée Boutique / Rapport / SAV) ─────────── */
const C = {
  atb: '#BE123C', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#2a2e38', white: '#FFFFFF',
};

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'atb';

/* ─── ICÔNES SECTIONS (style trait, comme AppIcons) ─────── */
const Ic = ({ children }) => (
  <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke="#fff"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    {children}
  </svg>
);
const IcOrders = () => (
  <Ic>
    <path d="M4 20 H20" />
    <rect x={5.5} y={12} width={3.4} height={6} rx={0.8} />
    <rect x={10.3} y={8} width={3.4} height={10} rx={0.8} />
    <rect x={15.1} y={5} width={3.4} height={13} rx={0.8} />
  </Ic>
);

/**
 * Modules de l'ATB. On en empile au fur et à mesure : ajouter une entrée ici,
 * puis son bloc de rendu plus bas. `ready:false` → tuile « Bientôt » non cliquable.
 */
const SECTIONS = [
  { key: 'commandes', label: 'Commandes / jour', color: '#BE123C', Icon: IcOrders, ready: true,
    subtitle: 'Volume de commandes payées par jour, comparé au mois et à l\'année précédents' },
];

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = (c) => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = (c) => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function ModuleTile({ label, color, Icon, disabled, onClick }) {
  return (
    <button
      className="mod-tile"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? 'Bientôt disponible' : label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        background: 'none', border: 'none', padding: 0, width: 124,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}
    >
      <div style={{
        width: 124, height: 124, borderRadius: 22, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(155deg, ${color} 0%, ${shade(color, -0.18)} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 8px 22px ${color}38, 0 1px 0 rgba(255,255,255,0.35) inset, 0 -1px 0 rgba(0,0,0,0.18) inset`,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)',
          pointerEvents: 'none',
        }} />
        <Icon />
        {disabled && (
          <span style={{
            position: 'absolute', top: 8, right: 8, padding: '2px 7px', borderRadius: 9,
            background: 'rgba(0,0,0,0.34)', color: '#fff', fontSize: 10, fontWeight: 800,
            letterSpacing: 0.3,
          }}>BIENTÔT</span>
        )}
      </div>
      <span style={{ fontSize: 13, fontWeight: 600, color: C.dark, textAlign: 'center' }}>{label}</span>
    </button>
  );
}

/* En-tête de l'app (avec retour optionnel vers l'accueil ATB) */
function AtbHeader({ title, subtitle, onBack }) {
  return (
    <div style={{ marginBottom: 22 }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: C.atb, cursor: 'pointer',
            fontSize: 13.5, fontWeight: 600, padding: 0, marginBottom: 12,
          }}
        >
          ‹ ATB
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 34, borderRadius: 5, background: C.atb, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.atb, margin: 0 }}>{title}</h1>
          <p style={{ fontSize: 13, color: C.greyM, fontWeight: 500, margin: '2px 0 0' }}>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default function ATBApp() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin } = useContext(AuthContext);

  const canRead = useMemo(
    () => isSuperAdmin || permissions?.[PERM_KEY]?.read === true,
    [isSuperAdmin, permissions],
  );

  const currentPath = `/atb${section ? `/${section}` : ''}`;
  const goHome = () => navigate('/atb');

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à l'ATB. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  const sectionDef = section ? SECTIONS.find((s) => s.key === section) : null;
  // Section inconnue → retour à l'accueil de l'app
  if (section && !sectionDef) return <Navigate to="/atb" replace />;

  return (
    <AppShell currentPath={currentPath}>
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: '#F2F6F8' }}>
        <style>{`
          .mod-tile { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1); }
          .mod-tile:not(:disabled):hover { transform: translateY(-3px) scale(1.03); }
        `}</style>

        <div style={{ padding: '24px 32px 40px', maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Accueil ATB : tuiles des modules ── */}
          {!section && (
            <>
              <AtbHeader title="ATB — Anthony Tool Box" subtitle="Boîte à outils : les modules s'ajoutent au fil de l'eau" />
              <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 26, justifyItems: 'center', maxWidth: 640,
              }}>
                {SECTIONS.map((s) => (
                  <ModuleTile
                    key={s.key}
                    label={s.label}
                    color={s.color}
                    Icon={s.Icon}
                    disabled={!s.ready}
                    onClick={() => navigate(`/atb/${s.key}`)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── Module Commandes / jour ── */}
          {section === 'commandes' && (
            <>
              <AtbHeader title="Commandes / jour" subtitle={sectionDef.subtitle} onBack={goHome} />
              <DailyOrdersTab />
            </>
          )}

          {/* ── Modules en construction ── */}
          {sectionDef && !sectionDef.ready && (
            <>
              <AtbHeader title={sectionDef.label} subtitle={sectionDef.subtitle || ''} onBack={goHome} />
              <div style={{
                padding: '48px 24px', textAlign: 'center', background: C.white,
                borderRadius: 14, border: `1px dashed ${C.greyB}`, color: C.greyT,
              }}>
                <p style={{ fontSize: 15, margin: 0 }}>Module « {sectionDef.label} » en construction.</p>
              </div>
            </>
          )}
        </div>
      </main>
    </AppShell>
  );
}
