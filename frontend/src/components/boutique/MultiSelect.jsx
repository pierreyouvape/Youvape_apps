import { useState, useEffect, useRef } from 'react';
import { C } from '../picking/pickingUi';
import { champ } from './statsShared';

/**
 * Liste déroulante à cases à cocher (catégories, sous-catégories…).
 * `value` : ids cochés ; aucun = « Toutes ». Se ferme au clic à l'extérieur.
 *
 * @param {{ id: string, label: string }[]} options
 * @param {[string, string]} noun singulier / pluriel (« catégorie », « catégories »)
 */
export default function MultiSelect({ options, value, onChange, noun, disabled, color = C.dark, minWidth = 200 }) {
  const [ouvert, setOuvert] = useState(false);
  const boite = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const fermer = (e) => { if (boite.current && !boite.current.contains(e.target)) setOuvert(false); };
    document.addEventListener('mousedown', fermer);
    return () => document.removeEventListener('mousedown', fermer);
  }, [ouvert]);

  const libelle = value.length === 0
    ? 'Toutes'
    : value.length === 1
      ? (options.find((o) => o.id === value[0])?.label || `1 ${noun[0]}`)
      : `${value.length} ${noun[1]}`;

  const basculer = (id) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div ref={boite} style={{ position: 'relative' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOuvert((o) => !o)}
        style={{
          ...champ, minWidth, textAlign: 'left', cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 8,
          borderColor: value.length ? color : C.greyB, fontWeight: value.length ? 600 : 400,
        }}
      >
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{libelle}</span>
        <span style={{ color: C.greyT, fontSize: 10 }}>▼</span>
      </button>
      {ouvert && !disabled && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 20, minWidth: Math.max(minWidth, 240),
          maxHeight: 360, overflowY: 'auto', background: C.white, border: `1px solid ${C.greyB}`,
          borderRadius: 10, boxShadow: '0 10px 28px rgba(0,0,0,0.12)', padding: 6,
        }}>
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} style={{
              background: 'none', border: 'none', color, fontWeight: 600, fontSize: 12.5,
              cursor: 'pointer', padding: '4px 8px', fontFamily: 'inherit',
            }}>Tout décocher</button>
          )}
          {options.length === 0 && <div style={{ padding: '6px 8px', color: C.greyM, fontSize: 13 }}>Aucune</div>}
          {options.map((o) => (
            <label key={o.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
              cursor: 'pointer', fontSize: 13.5, color: C.dark,
              background: value.includes(o.id) ? C.grey : 'transparent',
            }}>
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => basculer(o.id)} />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
