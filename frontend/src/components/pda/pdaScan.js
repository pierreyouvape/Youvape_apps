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

// ── Diagnostic : ?scandebug=1 (mémorisé), ?scandebug=0 pour l'éteindre ─────
// Affiche en bas d'écran tout ce que le lecteur envoie au navigateur, pour
// savoir comment un nouveau PDA transmet ses scans.
const scanDebug = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('scandebug');
    if (q !== null) localStorage.setItem('pdaScanDebug', q);
    return localStorage.getItem('pdaScanDebug') === '1';
  } catch { return false; }
})();

// Test EA530 : ?scansink=text retire inputmode="none" du champ invisible.
const sinkMode = (() => {
  try {
    const q = new URLSearchParams(window.location.search).get('scansink');
    if (q !== null) localStorage.setItem('pdaScanSink', q);
    return localStorage.getItem('pdaScanSink') || 'none';
  } catch { return 'none'; }
})();

let scanLog = () => {};
if (scanDebug && typeof document !== 'undefined') {
  const box = document.createElement('pre');
  Object.assign(box.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0', zIndex: '99999', margin: '0',
    maxHeight: '40vh', overflow: 'auto', background: 'rgba(0,0,0,0.85)', color: '#0f0',
    font: '11px/1.3 monospace', padding: '4px', pointerEvents: 'none', whiteSpace: 'pre-wrap',
  });
  const lines = [];
  const desc = (el) => (el ? `${el.tagName}${el.getAttribute?.('inputmode') ? `[${el.getAttribute('inputmode')}]` : ''}` : '-');
  const log = (txt) => {
    lines.push(`${new Date().toISOString().slice(17, 23)} ${txt}`);
    if (lines.length > 25) lines.shift();
    box.textContent = `focus=${desc(document.activeElement)}\n${lines.join('\n')}`;
    box.scrollTop = box.scrollHeight;
  };
  scanLog = log;
  const attach = () => { document.body.appendChild(box); log(`diagnostic scan actif, champ=${sinkMode}`); };
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);
  ['keydown', 'keyup', 'keypress'].forEach(t => window.addEventListener(t, (e) =>
    log(`${t} key=${JSON.stringify(e.key)} kc=${e.keyCode} on=${desc(e.target)} val=${JSON.stringify(e.target?.value ?? '')}`), true));
  window.addEventListener('keyup', (e) => setTimeout(() =>
    log(`  après ${e.key} : val=${JSON.stringify(document.activeElement?.value ?? '')}`), 50), true);
  ['beforeinput', 'input'].forEach(t => window.addEventListener(t, (e) =>
    log(`${t} type=${e.inputType} data=${JSON.stringify(e.data)} on=${desc(e.target)}`), true));
  ['compositionstart', 'compositionend', 'paste', 'textInput', 'focusin', 'focusout'].forEach(t =>
    window.addEventListener(t, (e) => log(`${t} data=${JSON.stringify(e.data ?? e.clipboardData?.getData('text') ?? '')} on=${desc(e.target)}`), true));
  setInterval(() => { box.textContent = box.textContent.replace(/^focus=.*$/m, `focus=${desc(document.activeElement)}`); }, 1000);
}

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
    if (sinkMode === 'none') sink.setAttribute('inputmode', 'none');
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
      scanLog(`ENTRÉE → champ invisible = ${JSON.stringify(sink.value)}`);
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
    // Chrome Android ne branche le clavier (donc le texte du Unitech) que sur
    // un champ focalisé PENDANT un geste : on le reprend dans le toucher même.
    const onTap = (e) => {
      if (!isField(e.target)) sink.focus({ preventScroll: true });
    };
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('click', onTap, true);
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
      document.removeEventListener('click', onTap, true);
      sink.remove();
    };
  }, [enabled]);
};

