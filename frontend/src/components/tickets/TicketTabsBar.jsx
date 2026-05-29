import { useOpenTickets } from '../../context/OpenTicketsContext';
import { useTicketStatuses } from './useTicketStatuses';
import { TICKETS_COLOR } from './ticketConstants';

const C = {
  blanc: '#fff', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38',
};

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  return '#' + adj(r).toString(16).padStart(2, '0') + adj(g).toString(16).padStart(2, '0') + adj(b).toString(16).padStart(2, '0');
}

function truncate(s, max = 28) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function IconList({ size = 13, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconClose({ size = 12, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export default function TicketTabsBar() {
  const { openTickets, activeTab, setActiveTab, closeTicket } = useOpenTickets();
  const { statusMap } = useTicketStatuses();

  const tabBase = {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    height: 36, padding: '0 12px', borderRadius: '8px 8px 0 0',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
    border: `1px solid ${C.grisCL}`, borderBottom: 'none',
    background: C.grisTL, color: C.grisF,
    fontFamily: 'Lato, sans-serif', whiteSpace: 'nowrap',
    transition: 'background 0.12s, color 0.12s',
    position: 'relative', top: 1,
  };

  const tabActive = {
    background: C.blanc, color: C.grisTF,
    borderColor: C.grisCL,
    fontWeight: 700,
    boxShadow: `inset 0 3px 0 ${TICKETS_COLOR}`,
  };

  return (
    <div style={{
      flexShrink: 0,
      background: '#F8FAFB',
      borderBottom: `1px solid ${C.grisCL}`,
      padding: '6px 16px 0',
      display: 'flex', alignItems: 'flex-end', gap: 4,
      overflowX: 'auto', overflowY: 'hidden',
      scrollbarWidth: 'thin',
      minHeight: 42,
    }}>
      {/* Onglet Liste (toujours premier, non fermable) */}
      <button
        onClick={() => setActiveTab('list')}
        style={{
          ...tabBase,
          ...(activeTab === 'list' ? tabActive : {}),
        }}
        title="Liste des tickets"
      >
        <IconList size={14} color={activeTab === 'list' ? TICKETS_COLOR : C.grisF} />
        <span>Liste</span>
      </button>

      {/* Onglets tickets */}
      {openTickets.map(t => {
        const isActive = activeTab === t.id;
        const status = statusMap[t.sav_status] || {};
        return (
          <div
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            onMouseDown={e => {
              // Middle-click = ferme l'onglet
              if (e.button === 1) { e.preventDefault(); closeTicket(t.id); }
            }}
            style={{
              ...tabBase,
              ...(isActive ? tabActive : {}),
              paddingRight: 6,
              maxWidth: 280,
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#EDF2F4'; }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = C.grisTL; }}
            title={`#${t.id} — ${t.subject || ''}`}
          >
            {/* Pastille statut */}
            <span style={{
              width: 8, height: 8, borderRadius: 2, flexShrink: 0,
              background: status.bg || '#F0F0F0',
              border: `1px solid ${status.color || C.grisCL}55`,
            }} />
            <span style={{
              color: isActive ? TICKETS_COLOR : C.grisF, fontWeight: 800, fontSize: 12.5,
            }}>#{t.id}</span>
            <span style={{
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
            }}>{truncate(t.subject || t.customer_name || '—', 26)}</span>
            <button
              onClick={e => { e.stopPropagation(); closeTicket(t.id); }}
              style={{
                width: 20, height: 20, borderRadius: 4,
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                color: C.grisM, padding: 0, flexShrink: 0,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#E2E8EC'; e.currentTarget.style.color = '#B71D1D'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.grisM; }}
              title="Fermer l'onglet"
            >
              <IconClose size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
