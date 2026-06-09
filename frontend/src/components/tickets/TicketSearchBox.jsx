import { useState, useRef, useEffect, useCallback } from 'react';
import { useOpenTickets } from '../../context/OpenTicketsContext';
import { useTicketStatuses } from './useTicketStatuses';
import { TICKETS_COLOR, formatTicketId } from './ticketConstants';

const C = {
  blanc: '#fff', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38',
};

const API = '/api/sav';

function IconSearch({ size = 14, color = C.grisM }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconClose({ size = 13, color = C.grisM }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Surligne la portion de texte qui matche la requête (insensible à la casse)
function Highlight({ text, query }) {
  if (!text) return null;
  const q = query.trim();
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

export default function TicketSearchBox() {
  const { openTicket, openSearch } = useOpenTickets();
  const { statusMap } = useTicketStatuses();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const timer = useRef();
  const boxRef = useRef();
  const inputRef = useRef();

  // Recherche dynamique (debounce 300 ms)
  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (!q) { setResults([]); setLoading(false); return; }
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}?search=${encodeURIComponent(q)}&limit=12`);
        const data = await res.json();
        if (data.success) {
          // On masque les tickets fusionnés (déjà absorbés dans une cible)
          setResults((data.tickets || []).filter(t => !t.merged_into_id));
        }
      } catch { /* silencieux */ }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [query]);

  // Fermer le dropdown au clic extérieur
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const choose = useCallback((t) => {
    openTicket(t);
    setOpen(false);
    setQuery('');
    setResults([]);
    inputRef.current?.blur();
  }, [openTicket]);

  const submitSearch = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    openSearch(q);
    setOpen(false);
    inputRef.current?.blur();
  }, [query, openSearch]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // Si une ligne du dropdown est explicitement surlignée (flèches) → ouvre ce ticket.
      // Sinon → ouvre l'onglet listant tous les résultats.
      if (activeIdx >= 0 && results[activeIdx]) choose(results[activeIdx]);
      else submitSearch();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)); }
  };

  // Reset surlignage navigation quand les résultats changent
  useEffect(() => { setActiveIdx(-1); }, [results]);

  const showDropdown = open && query.trim().length > 0;

  return (
    <div ref={boxRef} style={{ position: 'relative', marginLeft: 'auto', flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        height: 32, padding: '0 10px',
        background: C.blanc, border: `1px solid ${C.grisCL}`,
        borderRadius: 8, width: 280,
        transition: 'border-color 0.12s, box-shadow 0.12s',
        ...(open ? { borderColor: TICKETS_COLOR, boxShadow: `0 0 0 3px ${TICKETS_COLOR}1f` } : {}),
      }}>
        <IconSearch color={open ? TICKETS_COLOR : C.grisM} />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher un ticket…"
          style={{
            flex: 1, minWidth: 0, border: 'none', outline: 'none',
            fontSize: 13, fontFamily: 'Lato, sans-serif', color: C.grisTF,
            background: 'transparent',
          }}
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 20, height: 20, borderRadius: 4, border: 'none',
              background: 'transparent', cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            title="Effacer"
          >
            <IconClose />
          </button>
        )}
      </div>

      {showDropdown && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          width: 380, maxHeight: 420, overflowY: 'auto',
          background: C.blanc, borderRadius: 10,
          border: `1px solid ${C.grisCL}`,
          boxShadow: '0 10px 32px rgba(0,0,0,0.16)',
          zIndex: 200, padding: 6,
        }}>
          {loading && results.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>
              Recherche…
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: '14px 12px', fontSize: 12.5, color: C.grisM, textAlign: 'center' }}>
              Aucun ticket trouvé
            </div>
          ) : (
            results.map((t, idx) => {
              const status = statusMap[t.sav_status] || {};
              const active = idx === activeIdx;
              return (
                <button
                  key={t.id}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => choose(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                    background: active ? C.grisTL : 'transparent',
                    border: 'none', borderRadius: 7, padding: '8px 10px', cursor: 'pointer',
                    fontFamily: 'Lato, sans-serif',
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: 2, flexShrink: 0,
                    background: status.bg || '#F0F0F0',
                    border: `1px solid ${status.color || C.grisCL}55`,
                  }} />
                  <span style={{ fontSize: 12, fontWeight: 800, color: C.grisF, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {formatTicketId(t.id)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{
                      display: 'block', fontSize: 13, fontWeight: 600, color: C.grisTF,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      <Highlight text={t.customer_name || '—'} query={query} />
                    </span>
                    <span style={{
                      display: 'block', fontSize: 11.5, color: C.grisM,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      <Highlight text={t.customer_email || ''} query={query} />
                      {t.customer_phone && (
                        <> · <Highlight text={t.customer_phone} query={query} /></>
                      )}
                      {t.order_id && (
                        <> · cmd <Highlight text={String(t.order_id)} query={query} /></>
                      )}
                    </span>
                  </span>
                </button>
              );
            })
          )}

          {/* Pied : ouvrir l'onglet listant tous les résultats */}
          {!loading && results.length > 0 && (
            <button
              onClick={submitSearch}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', textAlign: 'left', marginTop: 4,
                borderTop: `1px solid ${C.grisCL}`, paddingTop: 8,
                background: 'transparent', border: 'none', cursor: 'pointer',
                fontFamily: 'Lato, sans-serif', padding: '10px',
              }}
              onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ fontSize: 12.5, fontWeight: 700, color: TICKETS_COLOR }}>
                Voir tous les résultats
              </span>
              <span style={{
                fontSize: 11, color: C.grisM, border: `1px solid ${C.grisCL}`,
                borderRadius: 4, padding: '1px 6px', fontWeight: 700,
              }}>Entrée ↵</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
