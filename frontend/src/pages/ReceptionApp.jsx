import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import AppShell from '../components/AppShell';

const C = {
  primary: '#135E84', accent: '#65A30D',
  grey: '#F9FAFB', greyB: '#E5E7EB', greyT: '#6B7280',
  dark: '#111827', white: '#FFFFFF',
};

/**
 * App Réception — réception des marchandises fournisseur.
 * Coquille en place (home / sidebar / permissions / route) ; l'interface est en
 * cours de définition.
 */
export default function ReceptionApp() {
  const { permissions } = useContext(AuthContext);
  const canRead = permissions?.reception?.read === true;

  if (permissions && !canRead) {
    return (
      <AppShell currentPath="/reception">
        <div style={{ padding: '40px 32px', color: C.greyT }}>
          Vous n'avez pas accès à l'application Réception. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell currentPath="/reception">
      <div style={{ padding: '24px 32px', maxWidth: 1560, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: C.primary, margin: 0 }}>Réception</h1>
        <p style={{ color: C.greyT, margin: '4px 0 0', fontSize: 13.5 }}>
          Réception des marchandises fournisseur.
        </p>

        <div style={{
          marginTop: 24, padding: '32px 24px', textAlign: 'center',
          background: C.white, border: `1px dashed ${C.greyB}`, borderRadius: 12, color: C.greyT,
        }}>
          Interface en cours de définition.
        </div>
      </div>
    </AppShell>
  );
}
