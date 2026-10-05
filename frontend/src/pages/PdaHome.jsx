import { useContext, useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { Catalog as ProductIcon, Picking as PickingIcon } from '../components/AppIcons';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';

/**
 * Accueil PDA (/pda) : l'icône installée sur l'écran d'accueil des Zebra
 * ouvre ici. Une tuile par app PDA, déclarée dans PDA_APPS ; `perm` = le droit
 * qui l'ouvre, s'il n'a pas le nom de l'app.
 */

const PDA_APPS = [
  { key: 'picking', path: '/pda/picking', label: 'Picking', hint: 'Préparer une vague', Icon: PickingIcon, color: C.violet },
  // Décision Pierre (05/10/2026) : qui a le PDA a tout — le droit Picking suffit.
  { key: 'produit', perm: 'picking', path: '/pda/produit', label: 'Produit', hint: 'Stock, emplacement, codes-barres', Icon: ProductIcon, color: C.primary },
];

export default function PdaHome() {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [currentWave, setCurrentWave] = useState(null);

  const apps = PDA_APPS.filter(a => isSuperAdmin || permissions?.[a.perm || a.key]?.read);

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
        {apps.length === 0 && (
          <p style={{ color: C.greyT, textAlign: 'center', padding: 30, fontSize: 16 }}>
            Aucune app PDA ouverte pour ce compte : demandez le droit à un responsable.
          </p>
        )}
        {apps.map(a => (
          <button
            key={a.key}
            onClick={() => navigate(a.path)}
            style={{
              display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
              padding: 18, borderRadius: 16, border: `2px solid ${C.greyB}`, background: C.white,
              fontFamily: 'inherit', color: C.dark, cursor: 'pointer',
            }}
          >
            <span style={{
              width: 56, height: 56, borderRadius: 14, background: a.color, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <a.Icon size={32} color="#fff" />
            </span>
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 21, fontWeight: 900 }}>{a.label}</span>
              <span style={{ display: 'block', fontSize: 14, color: C.greyT, marginTop: 2 }}>
                {a.key === 'picking' && currentWave
                  ? <strong style={{ color: C.violet }}>Vague en cours : {currentWave.waveNumber}</strong>
                  : a.hint}
              </span>
            </span>
            <span style={{ fontSize: 26, color: C.greyM }}>›</span>
          </button>
        ))}
      </div>
    </PdaLayout>
  );
}
