import { useState, useRef, useEffect, useMemo } from 'react';

const C = {
  atb: '#BE123C',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);

/**
 * Sélecteur multiple générique du constructeur de règles.
 *
 * `options` : [{ value, label, count? }]. `onChange` reçoit le tableau des valeurs.
 *
 * Le champ de recherche n'apparaît qu'au-delà de 8 options : sur une liste de
 * quatre statuts, il n'ajouterait qu'un obstacle.
 */
export default function MultiSelect({
  options = [], selected = [], onChange, placeholder = 'Choisir…', width = 260,
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const withSearch = options.length > 8;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => String(o.label).toLowerCase().includes(q));
  }, [options, search]);

  const label = useMemo(() => {
    if (!selected.length) return placeholder;
    if (selected.length === 1) {
      const o = options.find((x) => x.value === selected[0]);
      return o ? o.label : selected[0];
    }
    return `${selected.length} sélectionnés`;
  }, [selected, options, placeholder]);

  const toggle = (value) => {
    onChange(selectedSet.has(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width, maxWidth: '100%',
          padding: '7px 10px', borderRadius: 7, cursor: 'pointer',
          border: `1px solid ${selected.length ? C.atb : C.grisCL}`,
          background: C.blanc, color: selected.length ? C.grisTF : C.grisM,
          fontSize: 13, fontWeight: selected.length ? 600 : 500, textAlign: 'left',
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ color: C.grisM, fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 5,
          width: Math.max(width, 260), maxHeight: 320, display: 'flex', flexDirection: 'column',
          background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 9,
          boxShadow: '0 10px 30px rgba(0,0,0,0.13)',
        }}>
          {withSearch && (
            <div style={{ padding: 9, borderBottom: `1px solid ${C.grisCL}` }}>
              <input
                autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrer la liste…"
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '6px 8px',
                  border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5,
                  color: C.grisTF, outline: 'none',
                }}
              />
            </div>
          )}

          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              style={{
                padding: '7px 12px', border: 'none', borderBottom: `1px solid ${C.grisCL}`,
                background: C.grisTL, color: C.grisM, fontSize: 12, fontWeight: 600,
                cursor: 'pointer', textAlign: 'left',
              }}
            >
              Tout décocher
            </button>
          )}

          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
            {!visible.length && (
              <div style={{ padding: '13px 12px', fontSize: 12.5, color: C.grisM }}>Aucun résultat.</div>
            )}
            {visible.map((o) => {
              const on = selectedSet.has(o.value);
              return (
                <button
                  key={o.value}
                  onClick={() => toggle(o.value)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '6px 12px', border: 'none', cursor: 'pointer',
                    background: on ? `${C.atb}0F` : 'transparent', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${on ? C.atb : C.grisCL}`,
                    background: on ? C.atb : C.blanc,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.blanc, fontSize: 9, fontWeight: 900, lineHeight: 1,
                  }}>{on ? '✓' : ''}</span>
                  <span style={{ flex: 1, fontSize: 12.5, color: C.grisTF, fontWeight: on ? 700 : 500 }}>
                    {o.label}
                  </span>
                  {o.count != null && (
                    <span style={{ fontSize: 11, color: C.grisM }}>{fmtInt(o.count)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
