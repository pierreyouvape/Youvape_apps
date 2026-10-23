import { useContext, useMemo } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { useTableauInbox } from '../context/TableauInboxContext';
import AppShell from '../components/AppShell';
import PinBoard from '../components/tableau/PinBoard';
import RecurringTab from '../components/tableau/RecurringTab';
import { TABLEAU_COLOR } from '../components/tableau/tableauShared';

/** Clé de permission de l'app (miroir de `APPS` et de backend/src/config/apps.js). */
const PERM_KEY = 'tableau';

/** Onglets de l'app, dans l'ordre d'affichage. */
const TABS = [
  { key: 'epingle', label: 'Épinglé', subtitle: 'Vos post-its, à placer où vous voulez. Vous seul les voyez.' },
  { key: 'recurrentes', label: 'Récurrentes', subtitle: 'Vos tâches qui reviennent, avec rappel si besoin.' },
];

export default function TableauApp() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const { permissions, isSuperAdmin } = useContext(AuthContext);
  const { inbox } = useTableauInbox();

  const canRead = useMemo(
    () => isSuperAdmin || permissions?.[PERM_KEY]?.read === true,
    [isSuperAdmin, permissions],
  );

  const currentPath = `/tableau${tab ? `/${tab}` : ''}`;

  if (permissions && !canRead) {
    return (
      <AppShell currentPath={currentPath}>
        <div style={{ flex: 1, minWidth: 0, padding: '40px 32px', color: '#6B7280' }}>
          Vous n'avez pas accès au Tableau. Contactez un administrateur.
        </div>
      </AppShell>
    );
  }

  const tabDef = TABS.find((t) => t.key === tab);
  if (!tabDef) return <Navigate to="/tableau/epingle" replace />;

  // Pastilles d'onglet : post-its reçus et réponses côté Épinglé, rappels côté Récurrentes
  const badges = {
    epingle: inbox.incoming.length + inbox.answers.length,
    recurrentes: inbox.reminders.length,
  };

  return (
    <AppShell currentPath={currentPath}>
      <main className="main-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', background: '#F2F6F8' }}>
        <div style={{ padding: '24px 32px 40px', maxWidth: tab === 'epingle' ? 'none' : 1100, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
            <span style={{ width: 10, height: 34, borderRadius: 5, background: TABLEAU_COLOR, flexShrink: 0 }} />
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: TABLEAU_COLOR, margin: 0 }}>Tableau</h1>
              <p style={{ fontSize: 13, color: '#8A99A4', fontWeight: 500, margin: '2px 0 0' }}>{tabDef.subtitle}</p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, borderBottom: '1px solid #E5E7EB', marginBottom: 18 }}>
            {TABS.map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.key}
                  onClick={() => navigate(`/tableau/${t.key}`)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    padding: '9px 14px', marginBottom: -1, fontSize: 14,
                    fontWeight: active ? 800 : 600, color: active ? TABLEAU_COLOR : '#6B7280',
                    borderBottom: `3px solid ${active ? TABLEAU_COLOR : 'transparent'}`,
                    display: 'flex', alignItems: 'center', gap: 7,
                  }}
                >
                  {t.label}
                  {badges[t.key] > 0 && (
                    <span style={{
                      minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: '#DC2626',
                      color: '#fff', fontSize: 11, fontWeight: 800,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {badges[t.key]}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {tab === 'epingle' && <PinBoard />}
          {tab === 'recurrentes' && <RecurringTab />}
        </div>
      </main>
    </AppShell>
  );
}
