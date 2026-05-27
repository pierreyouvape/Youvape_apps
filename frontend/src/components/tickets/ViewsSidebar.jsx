import { DEFAULT_VIEWS, TICKETS_COLOR, TICKET_STATUSES } from './ticketConstants';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38',
};

export default function ViewsSidebar({ activeView, onViewChange, counts = {} }) {
  return (
    <aside style={{
      width: 220, flexShrink: 0,
      background: '#fff',
      borderRight: `1px solid ${C.grisCL}`,
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '20px 16px 12px',
        borderBottom: `1px solid ${C.grisCL}`,
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 1 }}>
          Vues
        </span>
      </div>

      {/* Liste des vues */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {DEFAULT_VIEWS.map(view => {
          const active = activeView === view.id;
          const count = counts[view.id] ?? null;
          return (
            <button
              key={view.id}
              onClick={() => onViewChange(view.id)}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 16px',
                background: active
                  ? `linear-gradient(90deg, rgba(8,145,178,0.10) 0%, rgba(8,145,178,0.04) 100%)`
                  : 'transparent',
                boxShadow: active ? `inset 3px 0 0 ${TICKETS_COLOR}` : 'none',
                border: 'none', cursor: 'pointer',
                fontSize: 13.5, fontWeight: active ? 700 : 400,
                color: C.grisTF,
                textAlign: 'left',
                transition: 'background 0.12s',
              }}
            >
              <span>{view.label}</span>
              {count !== null && (
                <span style={{
                  background: active ? TICKETS_COLOR : C.grisCL,
                  color: active ? '#fff' : C.grisF,
                  borderRadius: 99, padding: '1px 7px',
                  fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: 'center',
                }}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
