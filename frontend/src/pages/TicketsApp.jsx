import { useState, useCallback, useEffect } from 'react';
import AppShell from '../components/AppShell';
import ViewsSidebar from '../components/tickets/ViewsSidebar';
import TicketsList from '../components/tickets/TicketsList';
import TicketDetail from '../components/tickets/TicketDetail';
import TicketTabsBar from '../components/tickets/TicketTabsBar';
import { OpenTicketsProvider, useOpenTickets } from '../context/OpenTicketsContext';

// ─── Contenu enveloppé par OpenTicketsProvider ────────────────────────────────
function TicketsAppInner() {
  const [views, setViews]           = useState([]);
  const [activeView, setActiveView] = useState(null); // id numérique de la vue active
  const [counts, setCounts]         = useState({});
  const [refreshTick, setRefreshTick] = useState(0);
  const { activeTab } = useOpenTickets();

  // Charger les vues depuis l'API
  useEffect(() => {
    fetch('/api/sav/views')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.views.length > 0) {
          setViews(d.views);
          setActiveView(d.views[0].id); // première vue par défaut
        }
      })
      .catch(() => {});
  }, [refreshTick]);

  const handleCountsChange = useCallback((c) => setCounts(c), []);
  const handleRefresh = useCallback(() => setRefreshTick(t => t + 1), []);

  const activeViewObj = views.find(v => v.id === activeView) || null;

  return (
    <AppShell currentPath="/tickets">
      <div style={{
        flex: 1, minWidth: 0,
        display: 'flex',
        fontFamily: 'Lato, sans-serif',
        overflow: 'hidden',
        height: '100vh',
      }}>
        <ViewsSidebar
          views={views}
          activeView={activeView}
          onViewChange={(id) => setActiveView(id)}
          counts={counts}
          onRefresh={handleRefresh}
        />

        {/* Zone principale : barre d'onglets en haut + contenu (liste OU détail) */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <TicketTabsBar />

          {/* Contenu de l'onglet actif */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
            {/* On garde la liste montée en permanence (cache fetch + scroll position),
                mais on la masque si un ticket est ouvert. Le détail est démonté à la fermeture. */}
            <div style={{
              flex: 1, minWidth: 0,
              display: activeTab === 'list' ? 'flex' : 'none',
              flexDirection: 'column', overflow: 'hidden',
            }}>
              <TicketsList
                activeView={activeViewObj}
                views={views}
                onCountsChange={handleCountsChange}
                refreshTick={refreshTick}
              />
            </div>

            {activeTab !== 'list' && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
                <TicketDetail key={activeTab} ticketId={activeTab} />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

export default function TicketsApp() {
  return (
    <OpenTicketsProvider>
      <TicketsAppInner />
    </OpenTicketsProvider>
  );
}
