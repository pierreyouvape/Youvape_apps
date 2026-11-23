import { C } from '../picking/pickingUi';

/** Tuile d'app de l'accueil PDA (/pda) et des pages de section (Boutiques). */
export default function PdaTile({ label, hint, Icon, color, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 16, width: '100%', textAlign: 'left',
        padding: 18, borderRadius: 16, border: `2px solid ${C.greyB}`, background: C.white,
        fontFamily: 'inherit', color: C.dark, cursor: 'pointer',
      }}
    >
      <span style={{
        width: 56, height: 56, borderRadius: 14, background: color, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={32} color="#fff" />
      </span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 21, fontWeight: 900 }}>{label}</span>
        <span style={{ display: 'block', fontSize: 14, color: C.greyT, marginTop: 2 }}>{hint}</span>
      </span>
      <span style={{ fontSize: 26, color: C.greyM }}>›</span>
    </button>
  );
}
