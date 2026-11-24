import { useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { Boutique as BoutiqueIcon, Catalog as ProductIcon, Inventory as InventoryIcon, Picking as PickingIcon, SettingsIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import PdaTile from '../components/pda/PdaTile';
import { SHOPS } from '../components/boutique/shops';

/**
 * Accueil PDA (/pda) : l'icône installée sur l'écran d'accueil des Zebra
 * ouvre ici. Une tuile par app PDA, déclarée dans PDA_APPS ; `perm` = le droit
 * qui l'ouvre, s'il n'a pas le nom de l'app.
 *
 * Section « Boutiques » (23/11/2026) sous les apps, au-dessus du diagnostic :
 * une tuile par boutique, ouverte par le SEUL droit de cette boutique
 * (`boutique-mtp` / `boutique-cast`), jamais par le droit picking. Le
 * « Prélèvement boutique » reste une app à part, à sa place (décision Pierre).
 */

const PDA_APPS = [
  { key: 'picking', path: '/pda/picking', label: 'Picking', hint: 'Préparer une vague', Icon: PickingIcon, color: C.violet },
  // Décision Pierre (05/10/2026) : qui a le PDA a tout — le droit Picking suffit.
  { key: 'produit', perm: 'picking', path: '/pda/produit', label: 'Produit', hint: 'Stock, emplacement, codes-barres', Icon: ProductIcon, color: C.primary },
  // Même droit (06/10/2026) : l'inventaire se crée au bureau (droit `inventaire`), se compte ici.
  { key: 'inventaire', perm: 'picking', path: '/pda/inventaire', label: 'Inventaire', hint: 'Compter un emplacement', Icon: InventoryIcon, color: '#0369A1' },
  // Prélèvement au stock du site pour la boutique de Castelnau (10/11/2026) : tout vendeur = utilisateur PDA.
  { key: 'prelevement', perm: 'picking', path: '/pda/prelevement', label: 'Prélèvement boutique', hint: 'Prendre au stock du site pour Castelnau', Icon: PickingIcon, color: '#C2410C' },
];
// Diagnostic (13/10/2026) : comprendre comment un PDA transmet ses scans. Toujours en dernier.
const DEBUG_APP = { key: 'debug', perm: 'picking', path: '/pda/debug', label: 'Diagnostic scan', hint: 'Si un PDA ne scanne pas', Icon: SettingsIcon, color: C.greyM };

export default function PdaHome() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentWave, setCurrentWave] = useState(null);

  const allowed = (perm) => isSuperAdmin || permissions?.[perm]?.read;
  const apps = PDA_APPS.filter(a => allowed(a.perm || a.key));
  const shops = Object.values(SHOPS).filter(s => allowed(s.permKey));
  const debug = allowed(DEBUG_APP.perm) ? DEBUG_APP : null;

  // Une vague en cours ? On la signale sur la tuile : c'est là qu'il faut revenir.
  useEffect(() => {
    if (!apps.some(a => a.key === 'picking')) return;
    axios.get(`${API_URL}/picking/pda/waves`, authHeaders(token))
      .then(({ data }) => setCurrentWave(data.waves.find(w => w.id === data.current) || null))
      .catch(() => {});
  }, [token, apps.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PdaLayout title="Youvape PDA">
      <div style={{ padding: 14, display: 'grid', gap: 12 }}>
        {apps.length === 0 && shops.length === 0 && (
          <p style={{ color: C.greyT, textAlign: 'center', padding: 30, fontSize: 16 }}>
            Aucune app PDA ouverte pour ce compte : demandez le droit à un responsable.
          </p>
        )}
        {apps.map(a => (
          <PdaTile
            key={a.key} label={a.label} Icon={a.Icon} color={a.color} onClick={() => navigate(a.path)}
            hint={a.key === 'picking' && currentWave
              ? <strong style={{ color: C.violet }}>Vague en cours : {currentWave.waveNumber}</strong>
              : a.hint}
          />
        ))}
        {shops.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.greyT, textTransform: 'uppercase', letterSpacing: 0.5, margin: '10px 4px 0' }}>
              Boutiques
            </div>
            {shops.map(s => (
              <PdaTile
                key={s.slug} label={`Boutique ${s.label}`} hint="Comptage, réception" Icon={BoutiqueIcon} color={s.color}
                onClick={() => navigate(`/pda/boutique/${s.slug}`)}
              />
            ))}
          </>
        )}
        {debug && (
          <div style={{ marginTop: shops.length ? 10 : 0 }}>
            <PdaTile label={debug.label} hint={debug.hint} Icon={debug.Icon} color={debug.color} onClick={() => navigate(debug.path)} />
          </div>
        )}
      </div>
    </PdaLayout>
  );
}
