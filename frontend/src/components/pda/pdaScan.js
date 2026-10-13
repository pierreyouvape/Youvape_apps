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

/** Lecteur de codes-barres « clavier » : caractères rapides puis Entrée. */
export const useScanner = (onScan, enabled) => {
  const buffer = useRef('');
  const last = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
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
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
};

