import { useState, useCallback } from 'react';
import AppShell from '../components/AppShell';
import ViewsSidebar from '../components/tickets/ViewsSidebar';
import TicketsList from '../components/tickets/TicketsList';
import { Tickets as TicketsIcon } from '../components/AppIcons';

const TICKETS_COLOR = '#0891B2';

const C = {
  grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#fff',
};

export default function TicketsApp() {
  const [activeView, setActiveView] = useState('ouvert');
  const [counts, setCounts] = useState({});
  const handleCountsChange = useCallback((c) => setCounts(c), []);

  return (
    <AppShell currentPath="/tickets">
      <div style={{
        flex: 1, minWidth: 0, height: '100vh',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'Lato, sans-serif', color: C.grisTF,
        overflow: 'hidden',
      }}>
        {/* ── Header ─────────────────────────────────────────────── */}
        <header style={{
          background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
          padding: '0 24px', height: 58,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(155deg, ${TICKETS_COLOR} 0%, #065f7e 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${TICKETS_COLOR}55`,
            }}>
              <TicketsIcon size={18} color="#fff" />
            </div>
            <span style={{
              fontSize: 16, fontWeight: 800, color: C.grisTF,
              fontFamily: "'Tilt Warp', cursive",
            }}>
              SAV / Tickets
            </span>
          </div>
          <div style={{ fontSize: 12, color: C.grisM, fontWeight: 500 }}>
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </header>

        {/* ── Corps : sidebar + liste ─────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <ViewsSidebar
            activeView={activeView}
            onViewChange={setActiveView}
            counts={counts}
          />
          <TicketsList activeView={activeView} onCountsChange={handleCountsChange} />
        </div>
      </div>
    </AppShell>
  );
}
