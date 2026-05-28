import { useState, useCallback, useEffect } from 'react';
import AppShell from '../components/AppShell';
import ViewsSidebar from '../components/tickets/ViewsSidebar';
import TicketsList from '../components/tickets/TicketsList';

export default function TicketsApp() {
  const [views, setViews]           = useState([]);
  const [activeView, setActiveView] = useState(null); // id numérique de la vue active
  const [counts, setCounts]         = useState({});
  const [refreshTick, setRefreshTick] = useState(0);

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
        <TicketsList
          activeView={activeViewObj}
          views={views}
          onCountsChange={handleCountsChange}
          refreshTick={refreshTick}
        />
      </div>
    </AppShell>
  );
}
