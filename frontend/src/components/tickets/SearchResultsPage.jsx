import { useState, useEffect, useCallback } from 'react';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR, formatTicketId } from './ticketConstants';
import { formatDateUTC } from '../../utils/dateUtils';
import { useOpenTickets } from '../../context/OpenTicketsContext';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav';

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function IconMail() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={5} width={18} height={14} rx={2} /><path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function IconForm() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={4} y={3} width={16} height={18} rx={2} /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconSearch({ size = 20, color = '#fff' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

// Surligne la portion de texte qui matche la requête
function Highlight({ text, query }) {
  if (!text) return null;
  const q = (query || '').trim();
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark style={{ background: '#FFF1A8', color: 'inherit', padding: 0, borderRadius: 2 }}>
        {text.slice(i, i + q.length)}
      </mark>
      {text.slice(i + q.length)}
    </>
  );
}

export default function SearchResultsPage() {
  const { searchQuery, openTicket } = useOpenTickets();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchResults = useCallback(async () => {
    const q = (searchQuery || '').trim();
    if (!q) { setTickets([]); setTotal(0); setLoading(false); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ search: q, limit: 200, offset: 0 });
      const res = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.success) {
        const list = (data.tickets || []).filter(t => !t.merged_into_id);
        setTickets(list);
        setTotal(data.total ?? list.length);
      }
    } finally { setLoading(false); }
  }, [searchQuery]);

  useEffect(() => { fetchResults(); }, [fetchResults]);

  const thStyle = (align = 'left', width) => ({
    padding: '14px 16px', fontSize: 12, fontWeight: 700, color: C.grisF,
    textAlign: align, whiteSpace: 'nowrap', background: C.blanc,
    borderBottom: `1px solid ${C.grisCL}`, position: 'sticky', top: 0, zIndex: 2,
    width, userSelect: 'none',
  });
  const cell = { padding: '14px 16px', borderBottom: `1px solid ${C.grisCL}`, fontSize: 13.5, color: C.grisTF };

  return (
    <main className="main-scroll" style={{
      flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Lato, sans-serif', color: C.grisTF,
    }}>
      {/* Top bar */}
      <header style={{
        background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
        padding: '0 28px', minHeight: 58,
        display: 'flex', alignItems: 'center', gap: 14,
        position: 'sticky', top: 0, zIndex: 20, flexShrink: 0,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, flexShrink: 0,
          background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 4px 12px ${TICKETS_COLOR}38, 0 1px 0 rgba(255,255,255,0.35) inset`,
        }}>
          <IconSearch size={17} />
        </div>
        <span style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Recherche</span>
      </header>

      {/* Header de la recherche */}
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <h1 style={{
          fontSize: 26, fontWeight: 800, color: C.grisTF,
          fontFamily: "'Tilt Warp', cursive", letterSpacing: '-0.4px', margin: '0 0 4px',
        }}>
          Résultats pour « {searchQuery} »
        </h1>
        <div style={{ fontSize: 13, color: C.grisM, fontWeight: 600, marginBottom: 20 }}>
          <strong style={{ color: C.grisTF }}>{total}</strong> ticket{total > 1 ? 's' : ''} trouvé{total > 1 ? 's' : ''}
        </div>
      </div>

      {/* Table */}
      <div style={{ padding: '0 28px 28px', flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.grisM, fontSize: 14 }}>
            Recherche…
          </div>
        ) : tickets.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 200, color: C.grisM, fontSize: 14, gap: 8,
            background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
          }}>
            <IconSearch size={32} color={C.grisCL} />
            Aucun ticket ne correspond à « {searchQuery} »
          </div>
        ) : (
          <div style={{
            background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
            overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle('left')}>Statut du ticket</th>
                    <th style={thStyle('left', 70)}>ID</th>
                    <th style={thStyle('left')}>Sujet</th>
                    <th style={thStyle('left')}>Demandeur</th>
                    <th style={thStyle('left')}>Canal YV</th>
                    <th style={thStyle('left')}>Créé</th>
                    <th style={thStyle('left')}>Mis à jour</th>
                    <th style={{ ...thStyle('left'), width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr
                      key={t.id}
                      onClick={e => openTicket(t, { background: e.metaKey || e.ctrlKey })}
                      onMouseDown={e => { if (e.button === 1) { e.preventDefault(); openTicket(t, { background: true }); } }}
                      style={{ cursor: 'pointer', transition: 'background 0.12s' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#F8FBFD'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                      <td style={cell}><StatusBadge status={t.sav_status} /></td>
                      <td style={{ ...cell, color: C.grisF, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {formatTicketId(t.id)}
                      </td>
                      <td style={{ ...cell, maxWidth: 420 }}>
                        <span style={{
                          display: 'inline-block', maxWidth: '100%',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          fontWeight: 500, verticalAlign: 'middle',
                        }}>
                          <Highlight text={t.subject || '—'} query={searchQuery} />
                        </span>
                      </td>
                      <td style={cell}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, color: C.grisTF }}>
                          <Highlight text={t.customer_name || '—'} query={searchQuery} />
                        </div>
                        <div style={{ fontSize: 11.5, color: C.grisM }}>
                          <Highlight text={t.customer_email || ''} query={searchQuery} />
                          {t.customer_phone && (
                            <> · <Highlight text={t.customer_phone} query={searchQuery} /></>
                          )}
                          {t.order_id && (
                            <> · cmd <Highlight text={String(t.order_id)} query={searchQuery} /></>
                          )}
                        </div>
                      </td>
                      <td style={cell}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.grisF }}>
                          {t.source === 'gravity_form' ? <IconForm /> : <IconMail />}
                          {t.source === 'gravity_form' ? 'Formulaire' : 'E-mail'}
                        </span>
                      </td>
                      <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                        {formatDateUTC(t.created_at, { time: false })}
                      </td>
                      <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                        {formatDateUTC(t.updated_at, { time: true })}
                      </td>
                      <td style={{ ...cell, width: 30, color: C.grisM, textAlign: 'center' }}>
                        <IconChevron />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
