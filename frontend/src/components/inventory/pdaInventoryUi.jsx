import { useState } from 'react';
import { C } from '../picking/pickingUi';
import { pdaBtn as bigBtn } from '../pda/pdaStyles';
import { BLUE, input, pct, smallBtn } from './pdaInventoryApi';

/**
 * Briques communes aux écrans PDA de l'Inventaire (/pda/inventaire) :
 * inventaire classique (PdaInventaire) et par emplacement (PdaSpot).
 */

export const Photo = ({ url, size }) => (url
  ? <img src={url} alt="" loading="lazy" style={{
    width: size, height: size, objectFit: 'contain', borderRadius: 10, background: C.white, flexShrink: 0,
  }} />
  : <div style={{
    width: size, height: size, borderRadius: 10, background: C.greyB, flexShrink: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.greyM, fontSize: size / 3,
  }}>?</div>);

export const CameraButton = ({ onClick }) => (
  <button type="button" onClick={onClick} title="Scanner avec l'appareil photo" style={{
    ...smallBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px',
  }}>
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  </button>
);

export const Sheet = ({ title, onClose, children }) => (
  <div style={{
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 30,
    display: 'flex', alignItems: 'flex-start', padding: 12, paddingTop: 64, overflowY: 'auto',
  }}>
    <div style={{ background: C.white, borderRadius: 14, padding: 16, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, gap: 10 }}>
        <span style={{ fontWeight: 900, fontSize: 19, flex: 1 }}>{title}</span>
        <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '6px 12px' }}>Fermer</button>
      </div>
      {children}
    </div>
  </div>
);

/** Saisie d'une quantité au pavé numérique. */
export function QtySheet({ title, subtitle, initial, onSave, onClose, extra }) {
  const [value, setValue] = useState(initial == null ? '' : String(initial));
  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && n >= 0;
  return (
    <Sheet title={title} onClose={onClose}>
      {subtitle && <div style={{ fontSize: 15, color: C.greyT, marginBottom: 10 }}>{subtitle}</div>}
      <form onSubmit={(e) => { e.preventDefault(); if (valid) onSave(n); }}>
        <input
          autoFocus type="number" inputMode="numeric" min="0" value={value}
          onChange={(e) => setValue(e.target.value)} style={input}
        />
        <button type="submit" disabled={!valid} style={{ ...bigBtn(valid ? BLUE : C.greyB), width: '100%', marginTop: 12, fontSize: 19 }}>
          Enregistrer
        </button>
      </form>
      {extra}
    </Sheet>
  );
}

export const ProgressBar = ({ done, total }) => (
  <div style={{ height: 10, borderRadius: 999, background: C.greyB, overflow: 'hidden' }}>
    <div style={{ width: `${pct(done, total)}%`, height: '100%', background: C.green }} />
  </div>
);

/** Code tapé à la main (SKU, code-barres illisible). */
export function CodeSheet({ onCode, onClose, title = 'Saisir un code', placeholder = 'SKU ou code-barres', label = 'Compter' }) {
  const [value, setValue] = useState('');
  return (
    <Sheet title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (value.trim()) onCode(value.trim()); }}>
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder}
          style={{ ...input, fontSize: 20, fontWeight: 600 }} />
        <button type="submit" disabled={!value.trim()} style={{ ...bigBtn(BLUE), width: '100%', marginTop: 12 }}>{label}</button>
      </form>
    </Sheet>
  );
}
