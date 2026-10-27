import { useContext } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';
import { Picking as PickingIcon } from '../components/AppIcons';
import { C } from '../components/picking/pickingUi';
import PluginLogistiqueSection from '../components/picking/reglages/PluginLogistiqueSection';

/**
 * Réglages de l'app Picking, section par section.
 *
 * Distinct des règles des vagues (/picking/settings, bouton « Paramètres de
 * l'app ») : ici vivent les réglages de l'expédition. L'écran se lit avec le
 * droit picking ; enregistrer est réservé aux admins (le backend l'exige).
 */

// Une nouvelle section = une ligne de plus ici, son composant reçoit { token, canEdit }.
const SECTIONS = [
  { key: 'plugin-logistique', render: (props) => <PluginLogistiqueSection {...props} /> },
];

export default function PickingReglages() {
  const { token, isAdmin, isSuperAdmin } = useContext(AuthContext);
  const canEdit = isAdmin === true || isSuperAdmin === true;

  return (
    <AppShell currentPath="/picking/reglages">
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: C.grey }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '28px 24px 60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: C.violet,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <PickingIcon size={24} color="#fff" />
            </span>
            <h1 style={{ margin: 0, fontFamily: "'Tilt Warp', cursive", fontSize: 26, fontWeight: 900, color: C.primary }}>
              Réglages
            </h1>
            <Link to="/picking" style={{ marginLeft: 'auto', fontSize: 13.5, color: C.violet, fontWeight: 600, textDecoration: 'none' }}>
              ← Retour au Picking
            </Link>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {SECTIONS.map(({ key, render }) => <div key={key}>{render({ token, canEdit })}</div>)}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
