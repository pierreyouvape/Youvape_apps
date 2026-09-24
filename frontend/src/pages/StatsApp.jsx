import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReportsTab from '../components/stats/ReportsTab';
import CustomersStatsTab from '../components/stats/CustomersStatsTab';
import ProductsStatsTab from '../components/stats/ProductsStatsTab';
import BrandsStatsTab from '../components/stats/BrandsStatsTab';
import CategoriesStatsTab from '../components/stats/CategoriesStatsTab';
import OrdersStatsTab from '../components/stats/OrdersStatsTab';
import AnalysisTab from '../components/stats/AnalysisTab';
import { LinkBox } from '../utils/navHelpers';
import AppShell from '../components/AppShell';
import { Stats as StatsIcon } from '../components/AppIcons';

/* ─── PALETTE (alignée Rapport / Promos / Gestion employé) ─── */
const C = {
  app: '#E85A5A', appF: '#B93A3A',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

const TABS = [
  { id: 'reports', label: 'Rapports', component: ReportsTab },
  { id: 'clients', label: 'Clients', component: CustomersStatsTab },
  { id: 'products', label: 'Produits', component: ProductsStatsTab },
  { id: 'brands', label: 'Marques', component: BrandsStatsTab },
  { id: 'categories', label: 'Catégories', component: CategoriesStatsTab },
  { id: 'orders', label: 'Commandes', component: OrdersStatsTab },
  { id: 'analysis', label: 'Analyse', component: AnalysisTab },
];

const StatsApp = () => {
  const navigate = useNavigate();
  const { tab } = useParams();

  // Onglet actif basé sur l'URL, défaut = reports
  const activeTab = TABS.find((t) => t.id === tab)?.id || 'reports';
  const activeLabel = TABS.find((t) => t.id === activeTab)?.label;

  // Rediriger vers /stats/reports si on est sur /stats sans onglet
  useEffect(() => {
    if (!tab) navigate('/stats/reports', { replace: true });
  }, [tab, navigate]);

  const ActiveTabComponent = TABS.find((t) => t.id === activeTab)?.component;

  return (
    <AppShell currentPath="/stats">
      <main
        className="main-scroll stats-app"
        style={{
          flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
          display: 'flex', flexDirection: 'column',
          background: C.grisTL, fontFamily: 'Lato, sans-serif', color: C.grisTF,
        }}
      >
        <style>{`
          /* Barre d'onglets : défile horizontalement quand l'écran est étroit,
             plutôt que d'élargir la page. */
          .stats-tabs { overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; }
          .stats-tabs::-webkit-scrollbar { display: none; }
          .stats-tab { transition: background 0.15s, color 0.15s; }
          .stats-tab:not(.is-active):hover { background: ${C.grisTL}; color: ${C.grisTF}; }

          /* ── Mobile : on remet dans la largeur de l'écran ce qui était pensé
             pour un grand écran (colonnes fixes, panneaux latéraux, tableaux
             aérés). AppShell fait déjà défiler les tables horizontalement. ── */
          @media (max-width: 900px) {
            .stats-app .yv-row { flex-direction: column !important; }
            .stats-app .yv-side { width: 100% !important; }
            .stats-app .yv-reports-layout { flex-direction: column !important; min-height: 0 !important; }
            .stats-app .yv-reports-nav { width: 100% !important; }
          }
          @media (max-width: 768px) {
            .stats-app .stats-content { padding: 12px !important; }
            .stats-app th, .stats-app td { padding: 9px 10px !important; font-size: 12.5px !important; }
            /* 16px : en dessous, iOS zoome sur le champ au focus */
            .stats-app input, .stats-app select, .stats-app textarea { font-size: 16px !important; }
          }
        `}</style>

        {/* ── Barre supérieure ── */}
        <header
          style={{
            background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
            padding: '10px 16px', display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
            position: 'sticky', top: 0, zIndex: 30,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                background: `linear-gradient(155deg, ${C.app} 0%, ${C.appF} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 12px ${C.app}59`,
              }}
            >
              <StatsIcon size={18} color="#fff" />
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "'Tilt Warp', cursive", whiteSpace: 'nowrap' }}>
              Statistiques
            </span>
            <span style={{ color: C.grisCL }}>/</span>
            <span style={{
              fontSize: 13, color: C.grisF, fontWeight: 600,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {activeLabel}
            </span>
          </div>
          <LinkBox
            to="/stats/shipping-settings"
            display="inline-flex"
            style={{
              alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 8,
              border: `1px solid ${C.grisCL}`, background: C.grisTL, color: C.grisF,
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            ⚙️ Paramètres
          </LinkBox>
        </header>

        {/* ── Contenu ── */}
        <div className="stats-content" style={{ flex: 1, padding: 'clamp(12px, 2vw, 24px)', minWidth: 0 }}>
          {/* Onglets */}
          <div
            className="stats-tabs"
            style={{
              display: 'flex', gap: 2, marginBottom: 18, padding: 3,
              background: C.blanc, borderRadius: 10, border: `1px solid ${C.grisCL}`,
              width: 'fit-content', maxWidth: '100%',
            }}
          >
            {TABS.map((t) => {
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  className={`stats-tab${isActive ? ' is-active' : ''}`}
                  onClick={() => navigate(`/stats/${t.id}`)}
                  style={{
                    background: isActive ? C.app : 'transparent',
                    color: isActive ? C.blanc : C.grisF,
                    border: 'none', borderRadius: 8, cursor: 'pointer',
                    padding: '8px 14px', fontSize: 13.5, fontWeight: 700,
                    fontFamily: 'inherit', whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {ActiveTabComponent && <ActiveTabComponent />}
        </div>
      </main>
    </AppShell>
  );
};

export default StatsApp;
