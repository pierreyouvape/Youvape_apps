import { useState, useCallback } from 'react';
import AppShell from '../components/AppShell';
import ViewsSidebar from '../components/tickets/ViewsSidebar';
import TicketsList from '../components/tickets/TicketsList';

export default function TicketsApp() {
  const [activeView, setActiveView] = useState('ouvert');
  const [counts, setCounts] = useState({});
  const [refreshTick, setRefreshTick] = useState(0);

  const handleCountsChange = useCallback((c) => setCounts(c), []);
  const handleRefresh = useCallback(() => setRefreshTick(t => t + 1), []);

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
          activeView={activeView}
          onViewChange={(v) => { setActiveView(v); }}
          counts={counts}
          onRefresh={handleRefresh}
        />
        <TicketsList
          activeView={activeView}
          onCountsChange={handleCountsChange}
          refreshTick={refreshTick}
        />
      </div>
    </AppShell>
  );
}
