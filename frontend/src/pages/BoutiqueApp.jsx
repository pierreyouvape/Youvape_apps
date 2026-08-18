import { useContext, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import StockTab from '../components/boutique/StockTab';

/* ─── PALETTE (alignée Rapport / SAV / Réception) ───────── */
const C = {
  primary: '#135E84', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#2a2e38', white: '#FFFFFF',
};

/* ─── BOUTIQUES (miroir de backend/src/config/nextore.js) ── */
export const SHOPS = {
  montpellier: { id: 1, slug: 'montpellier', label: 'Montpellier', permKey: 'boutique-mtp',  color: '#0D9488' },
  castelnau:   { id: 2, slug: 'castelnau',   label: 'Castelnau',   permKey: 'boutique-cast', color: '#C2410C' },
};

/* ─── ICÔNES SECTIONS (style trait, comme AppIcons) ─────── */
const Ic = ({ children }) => (
  <svg width={50} height={50} viewBox="0 0 24 24" fill="none" stroke="#fff"
    strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    {children}
  </svg>
);
const IcStock = () => <Ic><rect x={4} y={7} width={16} height={13} rx={1.5} /><path d="M4 11 H20" /><path d="M9 7 V4 H15 V7" /></Ic>;
const IcNeeds = () => <Ic><path d="M4 20 H20" /><path d="M5 15 L10 10 L13 13 L19 6" /><path d="M15 6 H19 V10" /></Ic>;
const IcCount = () => <Ic><rect x={5} y={4} width={14} height={17} rx={2} /><path d="M9 4 V2.6 H15 V4" /><path d="M8.5 12 L11 14.5 L15.5 9.5" /></Ic>;
const IcSafe  = () => <Ic><rect x={3.5} y={5} width={17} height={14} rx={2} /><circle cx={11} cy={12} r={3.2} /><path d="M11 12 H13.6" /><path d="M17 9.5 V14.5" /></Ic>;

/* Sections de la boutique. `ready:false` → tuile « Bientôt » (non cliquable). */
const SECTIONS = [
  { key: 'stock',    label: 'Stock',    color: '#0D9488', Icon: IcStock, ready: true },
  { key: 'besoin',   label: 'Besoins',  color: '#E28F00', Icon: IcNeeds, ready: false },
  { key: 'comptage', label: 'Comptage', color: '#7C3AED', Icon: IcCount, ready: false },
  { key: 'coffre',   label: 'Coffre',   color: '#334155', Icon: IcSafe,  ready: false },
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

/* En-tête coloré de la boutique (avec retour optionnel vers l'accueil boutique) */
function ShopHeader({ shop, subtitle, onBack }) {
  return (
    <div style={{ marginBottom: 22 }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            background: 'none', border: 'none', color: C.primary, cursor: 'pointer',
            fontSize: 13.5, fontWeight: 600, padding: 0, marginBottom: 12,
          }}
        >
          ‹ Boutique {shop.label}
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ width: 10, height: 34, borderRadius: 5, background: shop.color, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>
            Boutique {shop.label}
          </h1>
          <p style={{ fontSize: 13, color: C.greyM, fontWeight: 500, margin: '2px 0 0' }}>{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default function BoutiqueApp() {
  const { shop: shopParam, section } = useParams();
  const navigate = useNavigate();
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const shop = SHOPS[String(shopParam || '').toLowerCase()];

  const canRead = useMemo(
    () => shop && (isSuperAdmin || permissions?.[shop.permKey]?.read === true),
    [shop, isSuperAdmin, permissions],
  );

  if (!shop) return <Navigate to="/home" replace />;

  const currentPath = `/boutique/${shop.slug}${section ? `/${section}` : ''}`;
  const goHome = () => navigate(`/boutique/${shop.slug}`);

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à la boutique {shop.label}. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  const sectionDef = section ? SECTIONS.find((s) => s.key === section) : null;
  // Section inconnue → retour à l'accueil boutique
  if (section && !sectionDef) return <Navigate to={`/boutique/${shop.slug}`} replace />;

  return (
    <AppShell currentPath={currentPath}>
      <style>{`
        .mod-tile { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1); }
        .mod-tile:not(:disabled):hover { transform: translateY(-3px) scale(1.03); }
      `}</style>
      <div style={{ flex: 1, minWidth: 0, padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>

        {/* ── Accueil boutique : tuiles des modules ── */}
        {!section && (
          <>
            <ShopHeader shop={shop} subtitle="Gestion de la boutique — données caisse Nextore" />
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
                  onClick={() => navigate(`/boutique/${shop.slug}/${s.key}`)}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Section Stock ── */}
        {section === 'stock' && (
          <>
            <ShopHeader shop={shop} subtitle="Suivi de stock — données caisse Nextore" onBack={goHome} />
            <StockTab shop={shop} token={token} />
          </>
        )}

        {/* ── Sections en construction ── */}
        {sectionDef && !sectionDef.ready && (
          <>
            <ShopHeader shop={shop} subtitle={sectionDef.label} onBack={goHome} />
            <div style={{
              padding: '48px 24px', textAlign: 'center', background: C.white,
              borderRadius: 14, border: `1px dashed ${C.greyB}`, color: C.greyT,
            }}>
              <p style={{ fontSize: 15, margin: 0 }}>Module « {sectionDef.label} » en construction.</p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
