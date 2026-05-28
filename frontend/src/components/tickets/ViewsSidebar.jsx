import { useNavigate } from 'react-router-dom';
import { TICKETS_COLOR } from './ticketConstants';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

function IconRefresh() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 7"/><path d="M21 3v4h-4"/>
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={TICKETS_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}

export default function ViewsSidebar({ views = [], activeView, onViewChange, counts = {}, onRefresh }) {
  const navigate = useNavigate();

  return (
    <aside style={{
      width: 260, minWidth: 260, flexShrink: 0,
      background: C.blanc,
      height: '100vh', position: 'sticky', top: 0,
      borderRight: `1px solid ${C.grisCL}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 20px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.grisCL}`,
      }}>
        <h2 style={{
          fontSize: 18, fontWeight: 800, color: C.grisTF,
          fontFamily: "'Tilt Warp', cursive",
          letterSpacing: '-0.3px', margin: 0,
        }}>Vues</h2>
        <button
          title="Rafraîchir"
          onClick={onRefresh}
          style={{
            width: 28, height: 28, borderRadius: 6,
            background: 'transparent', border: 'none',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0, transition: 'background 0.12s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        >
          <IconRefresh />
        </button>
      </div>

      {/* Liste des vues */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {views.map(view => {
          const active = activeView === view.id;
          const count = counts[view.id] ?? null;
          return (
            <button
              key={view.id}
              onClick={() => onViewChange(view.id)}
              style={{
                width: '100%', textAlign: 'left',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 20px',
                background: active
                  ? 'linear-gradient(90deg, rgba(8,145,178,0.10) 0%, rgba(8,145,178,0.04) 100%)'
                  : 'transparent',
                boxShadow: active ? `inset 3px 0 0 ${TICKETS_COLOR}` : 'none',
                border: 'none', cursor: 'pointer',
                fontFamily: 'Lato, sans-serif',
                fontSize: 14,
                fontWeight: active ? 700 : 400,
                color: C.grisTF,
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.grisTL; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {view.label}
              </span>
              {count !== null && (
                <span style={{
                  fontSize: 12, fontWeight: 700,
                  color: active ? TICKETS_COLOR : C.grisM,
                  fontVariantNumeric: 'tabular-nums',
                  minWidth: 22, textAlign: 'right',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Footer — lien paramètres */}
      <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.grisCL}` }}>
        <button
          onClick={() => navigate('/tickets/settings')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 700,
            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          Gérer les vues
          <IconSettings />
        </button>
      </div>
    </aside>
  );
}
