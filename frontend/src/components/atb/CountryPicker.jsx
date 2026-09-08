import { useState, useRef, useEffect, useMemo } from 'react';
import { getCountryFlag, getCountryName } from '../../utils/countries';

const C = {
  atb: '#BE123C',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisTF: '#2a2e38', blanc: '#FFFFFF',
};

const fmtInt = (n) => new Intl.NumberFormat('fr-FR').format(parseInt(n, 10) || 0);

/**
 * Sélecteur de pays multiple.
 *
 * Aucune sélection = TOUS les pays, pas « aucun ». C'est le seul défaut qui a un
 * sens ici : un graphique vide à l'ouverture ne dirait rien à personne.
 *
 * Les libellés et drapeaux viennent de `utils/countries.js`, déjà utilisé par les
 * autres écrans — le backend ne renvoie que le code et le volume.
 */
export default function CountryPicker({ countries, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const boxRef = useRef(null);

  // Fermeture au clic extérieur et à Échap : sans ça le panneau reste ouvert
  // par-dessus le graphique qu'on veut justement lire.
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      (c) => c.code.toLowerCase().includes(q) || getCountryName(c.code).toLowerCase().includes(q),
    );
  }, [countries, search]);

  const label = useMemo(() => {
    if (!selected.length) return 'Tous les pays';
    if (selected.length === 1) return `${getCountryFlag(selected[0])} ${getCountryName(selected[0])}`;
    if (selected.length <= 3) return selected.map((c) => getCountryFlag(c)).join(' ') + ` ${selected.length} pays`;
    return `${selected.length} pays`;
  }, [selected]);

  const toggle = (code) => {
    onChange(selectedSet.has(code) ? selected.filter((c) => c !== code) : [...selected, code]);
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: C.grisM }}>Pays</label>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, minWidth: 168,
          padding: '8px 11px', borderRadius: 8, cursor: 'pointer',
          border: `1px solid ${selected.length ? C.atb : C.grisCL}`,
          background: C.blanc, color: C.grisTF, fontSize: 13, fontWeight: 600,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: C.grisM, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 40, marginTop: 6,
          width: 290, maxHeight: 340, display: 'flex', flexDirection: 'column',
          background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,0.13)',
        }}>
          <div style={{ padding: 10, borderBottom: `1px solid ${C.grisCL}` }}>
            <input
              autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher un pays…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '7px 9px',
                border: `1px solid ${C.grisCL}`, borderRadius: 7, fontSize: 13,
                color: C.grisTF, outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button
                onClick={() => onChange([])}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${C.grisCL}`, background: selected.length ? C.blanc : C.grisTL,
                  color: C.grisTF, cursor: 'pointer',
                }}
              >
                Tous les pays
              </button>
              <button
                onClick={() => onChange(visible.map((c) => c.code))}
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisTF, cursor: 'pointer',
                }}
              >
                Tout cocher
              </button>
            </div>
          </div>

          <div style={{ overflowY: 'auto', padding: '4px 0' }}>
            {!visible.length && (
              <div style={{ padding: '14px 12px', fontSize: 13, color: C.grisM }}>Aucun pays trouvé.</div>
            )}
            {visible.map((c) => {
              const on = selectedSet.has(c.code);
              return (
                <button
                  key={c.code}
                  onClick={() => toggle(c.code)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 9,
                    padding: '7px 12px', border: 'none', cursor: 'pointer',
                    background: on ? `${C.atb}0F` : 'transparent', textAlign: 'left',
                  }}
                >
                  <span style={{
                    width: 15, height: 15, borderRadius: 4, flexShrink: 0,
                    border: `1.5px solid ${on ? C.atb : C.grisCL}`,
                    background: on ? C.atb : C.blanc,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: C.blanc, fontSize: 10, fontWeight: 900, lineHeight: 1,
                  }}>{on ? '✓' : ''}</span>
                  <span style={{ fontSize: 14 }}>{getCountryFlag(c.code)}</span>
                  <span style={{ flex: 1, fontSize: 13, color: C.grisTF, fontWeight: on ? 700 : 500 }}>
                    {getCountryName(c.code)}
                  </span>
                  <span style={{ fontSize: 11.5, color: C.grisM }}>{fmtInt(c.orders)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
