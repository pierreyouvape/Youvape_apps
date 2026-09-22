import { useContext, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import BarcodesTab from '../components/employees/BarcodesTab';
import EmployeesListTab from '../components/employees/EmployeesListTab';

/* ─── PALETTE (alignée ATB / Boutique / Rapport) ─────────── */
const C = {
  app: '#4338CA', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#2a2e38', white: '#FFFFFF',
};

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'employes';

/* ─── ICÔNES SECTIONS (style trait, comme AppIcons) ─────── */
const Ic = ({ children }) => (
  <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke="#fff"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    {children}
  </svg>
);
const IcList = () => (
  <Ic>
    <circle cx={8} cy={8} r={2.6} />
    <path d="M3.6 16.5 C4.4 14.3 6 13.2 8 13.2 C10 13.2 11.6 14.3 12.4 16.5" />
    <path d="M15 7.5 H20.8" />
    <path d="M15 12 H20.8" />
    <path d="M15 16.5 H20.8" />
  </Ic>
);
const IcBarcode = () => (
  <Ic>
    <path d="M3.5 6 V4.6 A1.1 1.1 0 0 1 4.6 3.5 H7" />
    <path d="M17 3.5 H19.4 A1.1 1.1 0 0 1 20.5 4.6 V6" />
    <path d="M20.5 18 V19.4 A1.1 1.1 0 0 1 19.4 20.5 H17" />
    <path d="M7 20.5 H4.6 A1.1 1.1 0 0 1 3.5 19.4 V18" />
    <path d="M7 7.5 V16.5 M9.6 7.5 V16.5 M12 7.5 V16.5 M14.4 7.5 V16.5 M17 7.5 V16.5" />
  </Ic>
);

/**
 * Modules de la gestion employé. On en empile au fil de l'eau : ajouter une
 * entrée ici, puis son bloc de rendu plus bas. `ready:false` → tuile « Bientôt »
 * non cliquable.
 */
const SECTIONS = [
  { key: 'liste', label: 'Liste employé', color: '#0F766E', Icon: IcList, ready: true,
    subtitle: "Les salariés, leur compte app et leurs droits — ajout, départ, suppression" },
  { key: 'codes-barres', label: 'Code barre', color: '#4338CA', Icon: IcBarcode, ready: true,
    subtitle: "Le code-barre de chaque salarié, et sa génération pour les nouveaux arrivants" },
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

/* En-tête de l'app (avec retour optionnel vers l'accueil de l'app) */
function EmployeesHeader({ title, subtitle, onBack }) {
  return (
    <div style={{ marginBottom: 22 }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: C.app, cursor: 'pointer',
            fontSize: 13.5, fontWeight: 600, padding: 0, marginBottom: 12,
          }}
        >
          ‹ Gestion employé
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 34, borderRadius: 5, background: C.app, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.app, margin: 0 }}>{title}</h1>
          <p style={{ fontSize: 13, color: C.greyM, fontWeight: 500, margin: '2px 0 0' }}>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default function EmployeesApp() {
  const { section } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin } = useContext(AuthContext);

  const canRead = useMemo(
    () => isSuperAdmin || permissions?.[PERM_KEY]?.read === true,
    [isSuperAdmin, permissions],
  );

  const currentPath = `/employes${section ? `/${section}` : ''}`;
  const goHome = () => navigate('/employes');

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à la gestion employé. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  const sectionDef = section ? SECTIONS.find((s) => s.key === section) : null;
  // Section inconnue → retour à l'accueil de l'app
  if (section && !sectionDef) return <Navigate to="/employes" replace />;

  return (
    <AppShell currentPath={currentPath}>
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: '#F2F6F8' }}>
        <style>{`
          .mod-tile { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1); }
          .mod-tile:not(:disabled):hover { transform: translateY(-3px) scale(1.03); }
        `}</style>

        <div style={{ padding: '24px 32px 40px', maxWidth: 1400, margin: '0 auto' }}>

          {/* ── Accueil : tuiles des modules ── */}
          {!section && (
            <>
              <EmployeesHeader
                title="Gestion employé"
                subtitle="Les modules s'ajoutent au fil de l'eau"
              />
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
                    onClick={() => navigate(`/employes/${s.key}`)}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── Module Liste employé ── */}
          {section === 'liste' && (
            <>
              <EmployeesHeader title="Liste employé" subtitle={sectionDef.subtitle} onBack={goHome} />
              <EmployeesListTab />
            </>
          )}

          {/* ── Module Code barre ── */}
          {section === 'codes-barres' && (
            <>
              <EmployeesHeader title="Code barre" subtitle={sectionDef.subtitle} onBack={goHome} />
              <BarcodesTab />
            </>
          )}

          {/* ── Modules en construction ── */}
          {sectionDef && !sectionDef.ready && (
            <>
              <EmployeesHeader title={sectionDef.label} subtitle={sectionDef.subtitle || ''} onBack={goHome} />
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
