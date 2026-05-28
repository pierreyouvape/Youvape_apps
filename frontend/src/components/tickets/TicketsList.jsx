import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR } from './ticketConstants';
import { formatDate } from '../../utils/dateUtils';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
  saphirF: '#003A56', vert: '#4AB866',
};

const API = '/api/sav';
const PAGE_SIZE = 50;

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* ─── Icônes canal ───────────────────────────────────────────────────────────── */
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
function IconSort({ dir }) {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
      <path d="M3 5 L6 2 L9 5" stroke={dir === 'asc' ? C.grisTF : C.grisM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 7 L6 10 L9 7" stroke={dir === 'desc' ? C.grisTF : C.grisM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconFilter() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={TICKETS_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18M6 12h12M10 19h4"/>
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="#fff" stroke="none">
      <path d="M7 4v16l13-8z"/>
    </svg>
  );
}
function IconPlus({ color = '#fff' }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

/* ─── Checkbox ───────────────────────────────────────────────────────────────── */
function Checkbox({ checked, indeterminate, onChange }) {
  return (
    <span
      onClick={e => { e.stopPropagation(); onChange(); }}
      style={{
        width: 18, height: 18, borderRadius: 4,
        border: `1.5px solid ${checked || indeterminate ? TICKETS_COLOR : C.grisCL}`,
        background: checked || indeterminate ? TICKETS_COLOR : C.blanc,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'all 0.15s', verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.5 L5 9 L10 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {indeterminate && !checked && (
        <svg width="11" height="3" viewBox="0 0 12 3" fill="none">
          <path d="M2 1.5 H10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      )}
    </span>
  );
}

/* ─── Composant principal ─────────────────────────────────────────────────────── */
export default function TicketsList({ activeView, views = [], onCountsChange, onRefresh, refreshTick }) {
  const navigate = useNavigate();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ key: 'updated', dir: 'desc' });
  const [selected, setSelected] = useState(new Set());

  // activeView est maintenant l'objet vue complet (avec .statuses tableau)
  const statusesFilter = activeView?.statuses || []; // [] = tous

  /* ── Fetch tickets ── */
  const fetchTickets = useCallback(async () => {
    if (!activeView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      // Ajouter les statuts comme paramètres répétés (Express qs les parse en tableau)
      statusesFilter.forEach(s => params.append('sav_statuses', s));
      const res = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.success) { setTickets(data.tickets); setTotal(data.total); }
    } finally { setLoading(false); }
  }, [activeView, statusesFilter.join(','), page, refreshTick]);

  /* ── Fetch counts pour sidebar ── */
  const fetchCounts = useCallback(async () => {
    if (!onCountsChange || views.length === 0) return;
    try {
      const results = {};
      await Promise.all(views.map(async v => {
        const p = new URLSearchParams({ limit: 1, offset: 0 });
        (v.statuses || []).forEach(s => p.append('sav_statuses', s));
        const res = await fetch(`${API}?${p}`);
        const data = await res.json();
        if (data.success) results[v.id] = data.total;
      }));
      onCountsChange(results);
    } catch {}
  }, [onCountsChange, views, refreshTick]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  useEffect(() => { fetchCounts(); }, [fetchCounts]);
  useEffect(() => { setPage(0); setSelected(new Set()); }, [activeView?.id]);

  /* ── Tri local ── */
  const sortedTickets = [...tickets].sort((a, b) => {
    let va = a[sort.key] ?? '', vb = b[sort.key] ?? '';
    if (sort.key === 'id') { va = Number(va); vb = Number(vb); }
    if (sort.key === 'updated_at' || sort.key === 'created_at') {
      va = new Date(va); vb = new Date(vb);
    }
    if (va < vb) return sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const onSort = (key) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  const onToggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const onToggleAll = () => setSelected(prev => prev.size === tickets.length ? new Set() : new Set(tickets.map(t => t.id)));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /* ── Styles entête colonne ── */
  const thStyle = (key, align = 'left', width) => ({
    padding: '14px 16px',
    fontSize: 12, fontWeight: 700, color: C.grisF,
    textAlign: align, whiteSpace: 'nowrap',
    background: C.blanc,
    borderBottom: `1px solid ${C.grisCL}`,
    position: 'sticky', top: 0, zIndex: 2,
    cursor: key ? 'pointer' : 'default',
    width, userSelect: 'none',
  });
  const cell = { padding: '14px 16px', borderBottom: `1px solid ${C.grisCL}`, fontSize: 13.5, color: C.grisTF };

  return (
    <main className="main-scroll" style={{
      flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Lato, sans-serif', color: C.grisTF,
    }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header style={{
        background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
        padding: '0 28px', minHeight: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 20, gap: 16, flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Icône app */}
          <div style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0,
            background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 4px 12px ${TICKETS_COLOR}38, 0 1px 0 rgba(255,255,255,0.35) inset`,
          }}>
            <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 9h8M8 13h5"/>
            </svg>
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Tickets</span>
          <span style={{ color: C.grisCL }}>/</span>
          <span style={{ fontSize: 13, color: C.grisF, fontWeight: 600 }}>{activeView?.label || 'Tous'}</span>
        </div>
        {/* Bouton Nouveau ticket */}
        <button
          onClick={() => {}}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.18)})`,
            color: '#fff', border: 'none',
            borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            boxShadow: `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
            transition: 'transform 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
        >
          <IconPlus /> Nouveau ticket
        </button>
      </header>

      {/* ── Vue header ──────────────────────────────────────────── */}
      <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16, flexWrap: 'wrap', marginBottom: 20,
        }}>
          <div>
            <h1 style={{
              fontSize: 26, fontWeight: 800, color: C.grisTF,
              fontFamily: "'Tilt Warp', cursive",
              letterSpacing: '-0.4px', margin: '0 0 4px',
            }}>{activeView?.label || 'Tous les tickets'}</h1>
            <div style={{ fontSize: 13, color: C.grisM, fontWeight: 600 }}>
              <strong style={{ color: C.grisTF }}>{total}</strong> ticket{total > 1 ? 's' : ''}
            </div>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div style={{ padding: '0 28px 28px', flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.grisM, fontSize: 14 }}>
            Chargement…
          </div>
        ) : tickets.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 200, color: C.grisM, fontSize: 14, gap: 8,
            background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
          }}>
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={C.grisCL} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Aucun ticket dans cette vue
          </div>
        ) : (
          <div style={{
            background: C.blanc, borderRadius: 12,
            border: `1px solid ${C.grisCL}`,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {/* Checkbox all */}
                    <th style={{ ...thStyle(null), padding: '14px 12px 14px 16px', width: 40 }}>
                      <Checkbox
                        checked={selected.size === tickets.length && tickets.length > 0}
                        indeterminate={selected.size > 0 && selected.size < tickets.length}
                        onChange={onToggleAll}
                      />
                    </th>
                    {[
                      { label: 'Statut du ticket', key: 'sav_status' },
                      { label: 'ID', key: 'id', width: 70 },
                      { label: 'Sujet', key: 'subject' },
                      { label: 'Demandeur', key: 'customer_name' },
                      { label: 'Canal YV', key: 'source' },
                      { label: 'Créé', key: 'created_at' },
                      { label: 'Mis à jour', key: 'updated_at' },
                    ].map(col => (
                      <th key={col.key} style={thStyle(col.key, 'left', col.width)} onClick={() => onSort(col.key)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {col.label}
                          <IconSort dir={sort.key === col.key ? sort.dir : null} />
                        </span>
                      </th>
                    ))}
                    {/* Chevron */}
                    <th style={{ ...thStyle(null), width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTickets.map(t => {
                    const isSel = selected.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => navigate(`/tickets/${t.id}`)}
                        style={{
                          background: isSel ? `rgba(8,145,178,0.06)` : 'transparent',
                          cursor: 'pointer', transition: 'background 0.12s',
                        }}
                        onMouseEnter={e => { if (!isSel) e.currentTarget.style.background = '#F8FBFD'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = isSel ? `rgba(8,145,178,0.06)` : 'transparent'; }}
                      >
                        {/* Checkbox */}
                        <td style={{ ...cell, padding: '14px 12px 14px 16px', width: 40 }}
                          onClick={e => { e.stopPropagation(); onToggle(t.id); }}>
                          <Checkbox checked={isSel} onChange={() => onToggle(t.id)} />
                        </td>
                        {/* Statut */}
                        <td style={cell}><StatusBadge status={t.sav_status} /></td>
                        {/* ID */}
                        <td style={{ ...cell, color: C.grisF, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          #{t.id}
                        </td>
                        {/* Sujet */}
                        <td style={{ ...cell, maxWidth: 420 }}>
                          <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
                            {t.subject || '—'}
                          </span>
                        </td>
                        {/* Demandeur */}
                        <td style={cell}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.grisTF }}>{t.customer_name || '—'}</div>
                          <div style={{ fontSize: 11.5, color: C.grisM }}>{t.customer_email}</div>
                        </td>
                        {/* Canal */}
                        <td style={cell}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.grisF }}>
                            {t.source === 'gravity_form' ? <IconForm /> : <IconMail />}
                            {t.source === 'gravity_form' ? 'Formulaire' : 'E-mail'}
                          </span>
                        </td>
                        {/* Créé */}
                        <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                          {formatDate(t.created_at, { time: false })}
                        </td>
                        {/* Mis à jour */}
                        <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                          {formatDate(t.updated_at, { time: true })}
                        </td>
                        {/* Chevron */}
                        <td style={{ ...cell, width: 30, color: C.grisM, textAlign: 'center' }}>
                          <IconChevron />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
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

        {/* ── Barre de sélection ── */}
        {selected.size > 0 && (
          <div style={{
            position: 'sticky', bottom: 16, marginTop: 16,
            background: C.saphirF, color: '#fff',
            borderRadius: 12, padding: '12px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16,
            boxShadow: '0 8px 24px rgba(0,58,86,0.35)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {selected.size} ticket{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {['Assigner', 'Changer statut', 'Marquer résolu'].map(label => (
                <button key={label} style={{
                  background: 'rgba(255,255,255,0.12)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
                  padding: '6px 14px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'Lato, sans-serif',
                }}>{label}</button>
              ))}
              <button onClick={() => setSelected(new Set())} style={{
                background: 'transparent', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
                padding: '6px 14px', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'Lato, sans-serif',
              }}>Annuler</button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
