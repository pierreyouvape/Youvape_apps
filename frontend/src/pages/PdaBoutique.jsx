import { useContext } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { Inventory as InventoryIcon, Reception as ReceptionIcon } from '../components/AppIcons';
import { C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import PdaTile from '../components/pda/PdaTile';
import ComptageTab from '../components/boutique/ComptageTab';
import CommandesTab from '../components/boutique/CommandesTab';
import { SHOPS } from '../components/boutique/shops';

/**
 * PDA › Boutiques (23/11/2026) : les apps d'une boutique sur le PDA.
 *   /pda/boutique/:shop        → les apps de la boutique
 *   /pda/boutique/:shop/:app   → l'app, même écran qu'au PC (mode `pda`)
 *
 * Ouvert par le SEUL droit de la boutique (`boutique-mtp` / `boutique-cast`).
 * Chaque écran porte le nom et la couleur de la boutique : un comptage passé
 * dans la mauvaise boutique écrirait un faux stock dans Nextore.
 *
 * Lots : 1 Comptage (23/11) ; 2 Réception (24/11) ; 3 Fiche produit. Pas
 * d'« Étiquettes à refaire » sur le PDA (décision Pierre).
 */
const SHOP_APPS = [
  { key: 'comptage', label: 'Comptage', hint: 'Inventaire de la boutique (Nextore)', Icon: InventoryIcon, color: '#7C3AED' },
  // Recevoir et valider une commande fournisseur ; créer / modifier : au PC
  { key: 'reception', label: 'Réception', hint: 'Recevoir une commande fournisseur', Icon: ReceptionIcon, color: '#0891B2' },
];

function ShopBand({ shop, app }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
      background: shop.color, color: '#fff', fontWeight: 800, fontSize: 16,
    }}>
      <span>Boutique {shop.label}</span>
      {app && <span style={{ fontWeight: 600, opacity: 0.9 }}>· {app.label}</span>}
    </div>
  );
}

export default function PdaBoutique() {
  const { shop: shopParam, app: appParam } = useParams();
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();

  const shop = SHOPS[String(shopParam || '').toLowerCase()];
  if (!shop || !(isSuperAdmin || permissions?.[shop.permKey]?.read)) return <Navigate to="/pda" replace />;

  const app = appParam ? SHOP_APPS.find((a) => a.key === appParam) : null;
  if (appParam && !app) return <Navigate to={`/pda/boutique/${shop.slug}`} replace />;

  if (!app) {
    return (
      <PdaLayout title={`Boutique ${shop.label}`} onBack={() => navigate('/pda')} backLabel="Accueil">
        <ShopBand shop={shop} />
        <div style={{ padding: 14, display: 'grid', gap: 12 }}>
          {SHOP_APPS.map((a) => (
            <PdaTile key={a.key} label={a.label} hint={a.hint} Icon={a.Icon} color={a.color}
              onClick={() => navigate(`/pda/boutique/${shop.slug}/${a.key}`)} />
          ))}
        </div>
      </PdaLayout>
    );
  }

  return (
    <PdaLayout title={app.label} onBack={() => navigate(`/pda/boutique/${shop.slug}`)} backLabel={shop.label}>
      <ShopBand shop={shop} app={app} />
      <div style={{ padding: 10, background: C.grey }}>
        {app.key === 'comptage' && <ComptageTab shop={shop} token={token} pda />}
        {app.key === 'reception' && <CommandesTab shop={shop} token={token} pda />}
      </div>
    </PdaLayout>
  );
}
