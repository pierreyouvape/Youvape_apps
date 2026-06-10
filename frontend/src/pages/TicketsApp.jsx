import { useState, useCallback, useEffect } from 'react';
import AppShell from '../components/AppShell';
import ViewsSidebar from '../components/tickets/ViewsSidebar';
import TicketsList from '../components/tickets/TicketsList';
import TicketDetail from '../components/tickets/TicketDetail';
import TicketTabsBar from '../components/tickets/TicketTabsBar';
import NewTicketPage from '../components/tickets/NewTicketPage';
import SearchResultsPage from '../components/tickets/SearchResultsPage';
import { applyViewsOrder, loadViewsOrder } from '../components/tickets/viewsOrder';
import { OpenTicketsProvider, useOpenTickets } from '../context/OpenTicketsContext';
import { useAutoRefresh } from '../components/tickets/useAutoRefresh';

// ─── Contenu enveloppé par OpenTicketsProvider ────────────────────────────────
function TicketsAppInner() {
  const [views, setViews]           = useState([]);
  const [activeView, setActiveView] = useState(null); // id numérique de la vue active
  const [counts, setCounts]         = useState({});
  const [refreshTick, setRefreshTick] = useState(0);
  // Suspend l'autorefresh quand l'agent agit sur la liste (sélection / menu)
  // ou quand il n'est pas sur l'onglet liste.
  const [listBusy, setListBusy] = useState(false);
  const { activeTab, playTicketId, isPlayActive, newDraftOpen, listRefreshTick } = useOpenTickets();

  const handleRefresh = useCallback(() => setRefreshTick(t => t + 1), []);

  // Un ticket a changé d'état depuis le détail (ex. changement de statut) →
  // rafraîchir la liste (montée en arrière-plan) sans attendre l'autorefresh.
  useEffect(() => {
    if (listRefreshTick > 0) handleRefresh();
  }, [listRefreshTick, handleRefresh]);

  const autoRefresh = useAutoRefresh(handleRefresh, {
    intervalMs: 60000,
    paused: listBusy || activeTab !== 'list',
  });

  // Charger les vues depuis l'API
  useEffect(() => {
    fetch('/api/sav/views')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.views.length > 0) {
          setViews(d.views);
          // Sélectionner la première vue dans l'ordre custom de l'utilisateur
          // (drag & drop persisté en localStorage)
          const ordered = applyViewsOrder(d.views, loadViewsOrder());
          setActiveView(ordered[0].id);
        }
      })
      .catch(() => {});
  }, [refreshTick]);

  // Fetch les compteurs de tickets par vue — indépendant de l'onglet affiché,
  // donc visibles même si l'utilisateur arrive sur un onglet ticket.
  useEffect(() => {
    if (views.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = {};
      await Promise.all(views.map(async v => {
        const p = new URLSearchParams({ limit: 1, offset: 0 });
        (v.statuses || []).forEach(s => p.append('sav_statuses', s));
        try {
          const res = await fetch(`/api/sav?${p}`);
          const data = await res.json();
          if (data.success) results[v.id] = data.total;
        } catch { /* ignore */ }
      }));
      if (!cancelled) setCounts(results);
    })();
    return () => { cancelled = true; };
  }, [views, refreshTick]);

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
                refreshTick={refreshTick}
                onRefresh={handleRefresh}
                autoRefresh={autoRefresh}
                onBusyChange={setListBusy}
              />
            </div>

            {activeTab !== 'list' && activeTab !== 'play' && activeTab !== 'new' && activeTab !== 'search' && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
                <TicketDetail key={activeTab} ticketId={activeTab} />
              </div>
            )}

            {activeTab === 'search' && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
                <SearchResultsPage />
              </div>
            )}

            {activeTab === 'play' && isPlayActive && playTicketId && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
                {/* key = ticketId pour forcer le remount à chaque ticket suivant */}
                <TicketDetail key={`play-${playTicketId}`} ticketId={playTicketId} />
              </div>
            )}

            {activeTab === 'new' && newDraftOpen && (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', overflow: 'hidden' }}>
                <NewTicketPage />
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
