import { useEffect, useRef } from 'react';

// ── Retours sensoriels : on scanne sans regarder l'écran ─────────────────────
let audioCtx = null;
export const beep = (ok) => {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1400 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.15;
    o.connect(g); g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.35));
  } catch { /* pas de son : tant pis */ }
  try { navigator.vibrate?.(ok ? 40 : [120, 60, 120]); } catch { /* pas de vibreur */ }
};

const isField = (el) => {
  const tag = el?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el?.isContentEditable;
};

/**
 * Lecteur de codes-barres « clavier » : caractères rapides puis Entrée.
 *
 * Deux façons de recevoir un scan :
 *   - Zebra (DataWedge) envoie de vraies touches → écoute au niveau de la page ;
 *   - Unitech (USS « Scan to Key ») INSÈRE le texte dans le champ actif, sans
 *     touches : sans champ, rien n'arrive. On garde donc un champ invisible
 *     focalisé, en inputmode="none" pour ne pas ouvrir le clavier virtuel.
 */
export const useScanner = (onScan, enabled) => {
  const buffer = useRef('');
  const last = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    const sink = document.createElement('input');
    sink.setAttribute('inputmode', 'none');
    sink.setAttribute('autocomplete', 'off');
    sink.setAttribute('aria-hidden', 'true');
    sink.tabIndex = -1;
    Object.assign(sink.style, {
      position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
      opacity: '0', border: '0', padding: '0', pointerEvents: 'none',
    });
    document.body.appendChild(sink);

    let stale = null;
    const flushSink = () => {
      clearTimeout(stale);
      const code = sink.value.trim();
      sink.value = '';
      if (code.length >= 3) handler.current(code);
    };
    const onSinkInput = () => {
      if (/[\r\n]/.test(sink.value)) { flushSink(); return; }
      // Scan sans Entrée : on ne le colle pas devant le suivant.
      clearTimeout(stale);
      stale = setTimeout(() => { sink.value = ''; }, 1000);
    };
    const onSinkKey = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      flushSink();
    };
    sink.addEventListener('input', onSinkInput);
    sink.addEventListener('keydown', onSinkKey);

    const grab = () => {
      if (!isField(document.activeElement)) sink.focus({ preventScroll: true });
    };
    // Un bouton touché vole le focus : on le reprend dès qu'il est libre.
    const onFocusOut = () => setTimeout(grab, 0);
    document.addEventListener('focusout', onFocusOut);
    grab();

    const onKey = (e) => {
      if (isField(e.target)) return;
      const now = Date.now();
      if (now - last.current > 300) buffer.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        const code = buffer.current.trim();
        buffer.current = '';
        if (code.length >= 3) handler.current(code);
        return;
      }
      if (e.key.length === 1) buffer.current += e.key;
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(stale);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusout', onFocusOut);
      sink.remove();
    };
  }, [enabled]);
};

