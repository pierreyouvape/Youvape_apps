import { useContext, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import StockTab from '../components/boutique/StockTab';
import BesoinsTab from '../components/boutique/BesoinsTab';
import ImportTab from '../components/boutique/ImportTab';
import CommandesTab from '../components/boutique/CommandesTab';
import ComptageTab from '../components/boutique/ComptageTab';
import StatsTab from '../components/boutique/StatsTab';
import CoffreTab from '../components/boutique/CoffreTab';

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
const IcDoc   = () => <Ic><path d="M14 3 H7 A1.5 1.5 0 0 0 5.5 4.5 V19.5 A1.5 1.5 0 0 0 7 21 H17 A1.5 1.5 0 0 0 18.5 19.5 V7.5 Z" /><path d="M14 3 V7.5 H18.5" /><path d="M12 10.5 V16.5" /><path d="M9.5 14 L12 16.5 L14.5 14" /></Ic>;
const IcBox   = () => <Ic><path d="M3.5 8 L12 4 L20.5 8 V16 L12 20 L3.5 16 Z" /><path d="M3.5 8 L12 12 L20.5 8" /><path d="M12 12 V20" /><path d="M8 10 L8 6" /></Ic>;
const IcCart  = () => <Ic><path d="M3 4 H5.5 L7.6 15 H18 L20 7.5 H6.4" /><circle cx={9} cy={19} r={1.4} /><circle cx={16.5} cy={19} r={1.4} /></Ic>;
const IcCount = () => <Ic><rect x={5} y={4} width={14} height={17} rx={2} /><path d="M9 4 V2.6 H15 V4" /><path d="M8.5 12 L11 14.5 L15.5 9.5" /></Ic>;
const IcStats = () => <Ic><path d="M4 20 H20" /><path d="M7 20 V13" /><path d="M12 20 V8" /><path d="M17 20 V4" /></Ic>;
const IcSafe  = () => <Ic><rect x={3.5} y={5} width={17} height={14} rx={2} /><circle cx={11} cy={12} r={3.2} /><path d="M11 12 H13.6" /><path d="M17 9.5 V14.5" /></Ic>;

/* Sections de la boutique. `ready:false` → tuile « Bientôt » (non cliquable).
 * `group` → la section vit sous la tuile de ce groupe (GROUPS), pas sur l'accueil. */
const SECTIONS = [
  { key: 'stock',    label: 'Stock',    color: '#0D9488', Icon: IcStock, ready: true },
  { key: 'besoin',   label: 'Besoins',  color: '#E28F00', Icon: IcNeeds, ready: true, group: 'achat' },
  { key: 'import',   label: 'Import commande', color: '#16A34A', Icon: IcDoc, ready: true, group: 'achat' },
  { key: 'commandes', label: 'Commandes', color: '#0891B2', Icon: IcBox, ready: true, group: 'achat' },
  { key: 'comptage', label: 'Comptage', color: '#7C3AED', Icon: IcCount, ready: true },
  // Droit à part `stats-boutiques` (Conseiller / Responsable), en plus du droit boutique.
  { key: 'stats',    label: 'Statistiques', color: '#A21CAF', Icon: IcStats, ready: true, permKey: 'stats-boutiques' },
  // Droit à part `coffre-boutiques`, en plus du droit boutique.
  { key: 'coffre',   label: 'Coffre',   color: '#334155', Icon: IcSafe,  ready: true, permKey: 'coffre-boutiques' },
];

/* Groupes de sections : une tuile sur l'accueil, qui ouvre ses propres tuiles. */
const GROUPS = [
  { key: 'achat', label: 'Achat', color: '#F59E0B', Icon: IcCart, subtitle: 'Achat — besoins, import de commande et commandes' },
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

  // Une section à droit propre n'existe pas pour qui ne l'a pas.
  const sections = SECTIONS.filter((s) => !s.permKey || isSuperAdmin || permissions?.[s.permKey]?.read === true);
  const statsLevel = isSuperAdmin || permissions?.['stats-boutiques']?.write ? 'Responsable' : 'Conseiller';

  const sectionDef = section ? sections.find((s) => s.key === section) : null;
  const groupDef = section ? GROUPS.find((g) => g.key === section && sections.some((s) => s.group === g.key)) : null;
  // Section inconnue (ou non autorisée) → retour à l'accueil boutique
  if (section && !sectionDef && !groupDef) return <Navigate to={`/boutique/${shop.slug}`} replace />;
  // Depuis une section d'un groupe, le retour ramène au groupe
  const goUp = sectionDef?.group ? () => navigate(`/boutique/${shop.slug}/${sectionDef.group}`) : goHome;

  // Accueil : les sections hors groupe, et chaque groupe à la place de son premier membre
  const homeTiles = [];
  for (const s of sections) {
    if (!s.group) homeTiles.push(s);
    else if (!homeTiles.some((x) => x.key === s.group)) homeTiles.push({ ...GROUPS.find((g) => g.key === s.group), ready: true });
  }
  const renderTiles = (list) => (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: 26, justifyItems: 'center', maxWidth: 640,
    }}>
      {list.map((s) => (
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
  );

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
            {renderTiles(homeTiles)}
          </>
        )}

        {/* ── Groupe (ex. Achat) : ses sections en tuiles ── */}
        {groupDef && (
          <>
            <ShopHeader shop={shop} subtitle={groupDef.subtitle} onBack={goHome} />
            {renderTiles(sections.filter((s) => s.group === groupDef.key))}
          </>
        )}

        {/* ── Section Stock ── */}
        {section === 'stock' && (
          <>
            <ShopHeader shop={shop} subtitle="Suivi de stock — données caisse Nextore" onBack={goHome} />
            <StockTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Besoins (prévision d'achat) ── */}
        {section === 'besoin' && (
          <>
            <ShopHeader shop={shop} subtitle="Besoins — prévision d'achat (vélocité des ventes)" onBack={goUp} />
            <BesoinsTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Import commande (parseurs fournisseur du site) ── */}
        {section === 'import' && (
          <>
            <ShopHeader shop={shop} subtitle="Import commande — document fournisseur → commande à réceptionner" onBack={goUp} />
            <ImportTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Commandes (réception → achat reçu dans Nextore) ── */}
        {section === 'commandes' && (
          <>
            <ShopHeader shop={shop} subtitle="Commandes — réception, modification, suppression ; la réception met le stock Nextore à jour" onBack={goUp} />
            <CommandesTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Comptage (inventaire) ── */}
        {section === 'comptage' && (
          <>
            <ShopHeader shop={shop} subtitle="Comptage — inventaire (écrit dans Nextore)" onBack={goHome} />
            <ComptageTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Statistiques (ventes caisse) ── */}
        {section === 'stats' && (
          <>
            <ShopHeader shop={shop} subtitle={`Statistiques — produits, marques et catégories les plus vendus · vue ${statsLevel}`} onBack={goHome} />
            <StatsTab shop={shop} token={token} />
          </>
        )}

        {/* ── Section Coffre (solde théorique, comptage, remises en banque) ── */}
        {section === 'coffre' && (
          <>
            <ShopHeader shop={shop} subtitle="Coffre — solde théorique, comptage et remises en banque" onBack={goHome} />
            <CoffreTab shop={shop} token={token} />
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
