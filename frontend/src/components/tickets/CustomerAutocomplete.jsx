import { useState, useEffect, useRef, useCallback } from 'react';
import { TICKETS_COLOR } from './ticketConstants';

const C = {
  blanc: '#fff', grisTL: '#F2F6F8', grisCL: '#E2E2E2',
  grisM: '#8A99A4', grisF: '#626E85', grisTF: '#2a2e38',
};

// Champ de recherche client avec autocomplete (email, prénom, nom).
// Au choix d'un client, appelle onSelect avec l'objet customer.
export default function CustomerAutocomplete({ value, onChange, onSelect, placeholder = 'Email, prénom ou nom…' }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const debounceRef = useRef();
  const containerRef = useRef();
  const inputRef = useRef();

  // Fermer si clic extérieur
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Fetch debounced
  const fetchResults = useCallback((q) => {
    if (!q || q.trim().length < 2) { setResults([]); setOpen(false); return; }
    setLoading(true);
    fetch(`/api/customers/search?q=${encodeURIComponent(q.trim())}&limit=8`)
      .then(r => r.json())
      .then(d => {
        const items = d.success ? (d.data || []) : [];
        setResults(items);
        setOpen(items.length > 0);
        setHighlighted(items.length > 0 ? 0 : -1);
      })
      .catch(() => { setResults([]); setOpen(false); })
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(v), 250);
  };

  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted(i => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted >= 0 && highlighted < results.length) selectCustomer(results[highlighted]);
    }
    else if (e.key === 'Escape') setOpen(false);
  };

  const selectCustomer = (c) => {
    onSelect?.(c);
    setOpen(false);
    setResults([]);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        value={value || ''}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%', border: `1px solid ${C.grisCL}`, background: C.blanc,
          borderRadius: 8, padding: '9px 12px', fontSize: 13.5,
          fontFamily: 'Lato, sans-serif', color: C.grisTF, outline: 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s', boxSizing: 'border-box',
        }}
        onFocusCapture={e => { e.target.style.borderColor = TICKETS_COLOR; e.target.style.boxShadow = '0 0 0 3px rgba(8,145,178,0.16)'; }}
        onBlurCapture={e => { e.target.style.borderColor = C.grisCL; e.target.style.boxShadow = 'none'; }}
      />

      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 200,
          background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8,
          boxShadow: '0 6px 24px rgba(0,0,0,0.10)', overflow: 'hidden', maxHeight: 320, overflowY: 'auto',
        }}>
          {results.map((c, i) => {
            const isHL = i === highlighted;
            const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || '—';
            return (
              <div
                key={c.id}
                onMouseDown={(e) => { e.preventDefault(); selectCustomer(c); }}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  padding: '8px 12px', cursor: 'pointer',
                  background: isHL ? `${TICKETS_COLOR}10` : 'transparent',
                  borderBottom: i < results.length - 1 ? `1px solid ${C.grisCL}40` : 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: C.grisTF, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11.5, color: C.grisM, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.email || '—'}
                  </div>
                </div>
                {c.order_count > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, color: TICKETS_COLOR,
                    background: `${TICKETS_COLOR}15`, borderRadius: 4, padding: '2px 6px',
                    whiteSpace: 'nowrap',
                  }}>
                    {c.order_count} cmd
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && (
        <span style={{
          position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
          fontSize: 11, color: C.grisM, fontStyle: 'italic',
        }}>…</span>
      )}
    </div>
  );
}
