import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR, DEFAULT_VIEWS } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav';
const PAGE_SIZE = 50;

// ─── Icône enveloppe ─────────────────────────────────────────────────────────
function IconMail() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={5} width={18} height={14} rx={2} />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function IconForm() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </svg>
  );
}

export default function TicketsList({ activeView, onCountsChange }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  // Résoudre le filtre de statut depuis la vue active
  const view = DEFAULT_VIEWS.find(v => v.id === activeView);
  const statusFilter = view?.status ?? null;

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        ...(statusFilter && { sav_status: statusFilter }),
        ...(search && { search }),
      });
      const res = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.success) {
        setTickets(data.tickets);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, page]);

  // Charger les counts pour la sidebar (remontés au parent via callback)
  const fetchCounts = useCallback(async () => {
    if (!onCountsChange) return;
    try {
      const results = {};
      await Promise.all(DEFAULT_VIEWS.map(async v => {
        const params = new URLSearchParams({ limit: 1, offset: 0, ...(v.status && { sav_status: v.status }) });
        const res = await fetch(`${API}?${params}`);
        const data = await res.json();
        if (data.success) results[v.id] = data.total;
      }));
      onCountsChange(results);
    } catch {}
  }, [onCountsChange]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  // Reset page quand la vue ou la recherche change
  useEffect(() => { setPage(0); }, [activeView, search]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: C.grisTL }}>

      {/* ── Barre de filtres ──────────────────────────────────────────── */}
      <div style={{
        padding: '14px 20px', background: C.blanc,
        borderBottom: `1px solid ${C.grisCL}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 380 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.grisM }} width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <circle cx={11} cy={11} r={8} /><path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Rechercher nom, email, commande, sujet…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', padding: '8px 12px 8px 32px',
              border: `1px solid ${C.grisCL}`, borderRadius: 8,
              fontSize: 13.5, fontFamily: 'Lato, sans-serif',
              color: C.grisTF, outline: 'none',
            }}
          />
        </div>
        <span style={{ fontSize: 13, color: C.grisM, marginLeft: 'auto' }}>
          {total} ticket{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.grisM, fontSize: 14 }}>
            Chargement…
          </div>
        ) : tickets.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.grisM, fontSize: 14 }}>
            Aucun ticket
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: C.blanc, borderBottom: `2px solid ${C.grisCL}` }}>
                {['#', 'Canal', 'Client', 'Sujet', 'Commande', 'Statut', 'Dernière maj'].map(h => (
                  <th key={h} style={{
                    padding: '10px 14px', textAlign: 'left',
                    fontSize: 11.5, fontWeight: 700, color: C.grisM,
                    textTransform: 'uppercase', letterSpacing: 0.5,
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr
                  key={t.id}
                  onClick={() => navigate(`/tickets/${t.id}`)}
                  style={{ borderBottom: `1px solid ${C.grisCL}`, cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#F8FBFD'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '12px 14px', fontSize: 13, color: C.grisM, fontWeight: 600 }}>
                    #{t.id}
                  </td>
                  <td style={{ padding: '12px 14px', color: C.grisF }}>
                    <span title={t.source === 'gravity_form' ? 'Formulaire' : 'Email'}>
                      {t.source === 'gravity_form' ? <IconForm /> : <IconMail />}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: C.grisTF }}>{t.customer_name || '—'}</div>
                    <div style={{ fontSize: 12, color: C.grisM }}>{t.customer_email}</div>
                  </td>
                  <td style={{ padding: '12px 14px', maxWidth: 300 }}>
                    <div style={{
                      fontSize: 13.5, color: C.grisTF,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {t.subject || '—'}
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 13, color: t.order_id ? TICKETS_COLOR : C.grisM, fontWeight: t.order_id ? 600 : 400 }}>
                    {t.order_id ? `#${t.order_id}` : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <StatusBadge status={t.sav_status} size="sm" />
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: 12.5, color: C.grisM, whiteSpace: 'nowrap' }}>
                    {formatDate(t.updated_at, { time: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{
          padding: '10px 20px', background: C.blanc,
          borderTop: `1px solid ${C.grisCL}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        }}>
          <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
            style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, cursor: page === 0 ? 'not-allowed' : 'pointer', color: C.grisF, fontSize: 13 }}>
            ← Préc.
          </button>
          <span style={{ fontSize: 13, color: C.grisM }}>{page + 1} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
            style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', color: C.grisF, fontSize: 13 }}>
            Suiv. →
          </button>
        </div>
      )}
    </div>
  );
}
