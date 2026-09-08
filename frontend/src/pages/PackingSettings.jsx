import { useState } from 'react';
import AppShell from '../components/AppShell';
import MethodMappingTab from '../components/shipping/MethodMappingTab';
import CarrierAccountsTab from '../components/shipping/CarrierAccountsTab';

/**
 * Paramètres de l'app Packing.
 *
 * Ils vivent ici et non dans les réglages Livraison (app Stats, où sont les
 * tarifs) parce que c'est dans le packing que le problème apparaît — un
 * préparateur bloqué sur un mode de livraison inconnu — et que le message
 * affiché à l'écran dit d'aller chercher un responsable. L'envoyer dans une
 * autre app, sous un onglet de tarification, rendait le parcours absurde.
 *
 * L'entrée du menu n'apparaît qu'aux porteurs du droit `transporteurs` en
 * écriture (cf. AppShell). L'API applique le même contrôle : la page n'est pas
 * une simple décoration, elle serait inutilisable sans le droit.
 */
const ONGLETS = [
  { id: 'etiquetage', label: 'Modes de livraison' },
  { id: 'contrats',   label: 'Contrats API' }
];

function PackingSettings() {
  const [onglet, setOnglet] = useState('etiquetage');

  return (
    <AppShell currentPath="/packing/settings">
      <div style={{ padding: '25px 30px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '24px', color: '#333' }}>
          Paramètres du packing
        </h1>
        <p style={{ margin: '0 0 22px', color: '#666', fontSize: '14px' }}>
          Quel transporteur pour quel mode de livraison, et avec quels identifiants d'API.
        </p>

        <div style={{ backgroundColor: 'white', borderRadius: '12px', border: '1px solid #e9ecef', overflow: 'hidden' }}>
          <div style={{ display: 'flex', borderBottom: '2px solid #eee' }}>
            {ONGLETS.map(o => (
              <div key={o.id} onClick={() => setOnglet(o.id)} style={{
                padding: '13px 26px', cursor: 'pointer',
                borderBottom: onglet === o.id ? '3px solid #6366f1' : '3px solid transparent',
                color: onglet === o.id ? '#6366f1' : '#666',
                fontWeight: onglet === o.id ? 'bold' : 'normal'
              }}>{o.label}</div>
            ))}
          </div>
          {onglet === 'etiquetage' ? <MethodMappingTab /> : <CarrierAccountsTab />}
        </div>
      </div>
    </AppShell>
  );
}

export default PackingSettings;
