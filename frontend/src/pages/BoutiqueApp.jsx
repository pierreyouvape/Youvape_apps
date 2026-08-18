import { useContext, useMemo } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import StockTab from '../components/boutique/StockTab';

/* ─── PALETTE (alignée Rapport / SAV / Réception) ───────── */
const C = {
  primary: '#135E84', accent: '#E28F00',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280', greyM: '#8A99A4',
  dark: '#111827', white: '#FFFFFF',
};

/* ─── BOUTIQUES (miroir de backend/src/config/nextore.js) ── */
export const SHOPS = {
  montpellier: { id: 1, slug: 'montpellier', label: 'Montpellier', permKey: 'boutique-mtp',  color: '#0D9488' },
  castelnau:   { id: 2, slug: 'castelnau',   label: 'Castelnau',   permKey: 'boutique-cast', color: '#C2410C' },
};

export default function BoutiqueApp() {
  const { shop: shopParam } = useParams();
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const shop = SHOPS[String(shopParam || '').toLowerCase()];

  if (!shop) return <Navigate to="/home" replace />;

  const canRead = useMemo(
    () => isSuperAdmin || permissions?.[shop.permKey]?.read === true,
    [isSuperAdmin, permissions, shop.permKey],
  );

  const currentPath = `/boutique/${shop.slug}`;

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à la boutique {shop.label}. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath={currentPath}>
      <div style={{ flex: 1, minWidth: 0, padding: '24px 32px', maxWidth: 1400, margin: '0 auto' }}>
        {/* En-tête boutique — couleur dédiée pour distinguer les deux magasins */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20,
          flexWrap: 'wrap',
        }}>
          <span style={{
            width: 10, height: 34, borderRadius: 5, background: shop.color, flexShrink: 0,
          }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>
              Boutique {shop.label}
            </h1>
            <p style={{ fontSize: 13, color: C.greyM, fontWeight: 500, margin: '2px 0 0' }}>
              Suivi de stock — données caisse Nextore
            </p>
          </div>
        </div>

        <StockTab shop={shop} token={token} />
      </div>
    </AppShell>
  );
}
