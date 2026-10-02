import { C } from '../picking/pickingUi';

/** Gros bouton tactile des pages PDA. */
export const pdaBtn = (bg, color = C.white) => ({
  border: 'none', borderRadius: 12, background: bg, color, fontWeight: 800, fontSize: 17,
  padding: '14px 18px', cursor: 'pointer', fontFamily: 'inherit',
});
