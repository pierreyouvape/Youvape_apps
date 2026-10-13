import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { API_URL, authHeaders, C } from '../components/picking/pickingUi';
import PdaLayout from '../components/pda/PdaLayout';
import { pdaBtn } from '../components/pda/pdaStyles';
import { beep, useScanner } from '../components/pda/pdaScan';

/**
 * Diagnostic des scans — /pda/debug (13/10/2026).
 *
 * Pour comprendre comment un PDA transmet ses scans : chaque événement reçu par
 * la page (touches, saisie, collage, focus) est journalisé avec son détail, et
 * le lecteur réel des apps PDA (`useScanner`) tourne en parallèle — on voit
 * donc à la fois ce qui arrive et si les apps le reconnaîtraient.
 *
 * Trois façons de scanner, pour comparer : sans rien sélectionner (comme dans
 * les apps), dans un champ de saisie normal, dans un champ sans clavier
 * virtuel (inputmode=none). « Envoyer au serveur » écrit le journal dans les
 * logs du backend (`[PDA debug]`), pour le lire sans photo d'écran.
 */

const EVENTS = [
  'keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'textInput',
  'compositionstart', 'compositionupdate', 'compositionend', 'paste', 'focusin', 'focusout',
];

const describe = (el) => {
  if (!el || el === document.body) return 'body';
  if (el === document) return 'document';
  const tag = el.tagName?.toLowerCase() || '?';
  return el.dataset?.zone ? `${tag}[${el.dataset.zone}]` : tag;
};

const summarize = (e, t0) => {
  const r = { t: Math.round(performance.now() - t0), type: e.type, target: describe(e.target), focus: describe(document.activeElement) };
  if (e.type.startsWith('key')) {
    Object.assign(r, { key: e.key, code: e.code, keyCode: e.keyCode, which: e.which });
    if (e.repeat) r.repeat = true;
    if (e.isComposing) r.composing = true;
  }
  if ('data' in e && e.data != null) r.data = e.data;
  if (e.inputType) r.inputType = e.inputType;
  if (e.type === 'paste') r.data = e.clipboardData?.getData('text') ?? '(illisible)';
  if (e.type === 'input' && e.target?.value != null) r.value = e.target.value;
  return r;
};

const line = (r) => {
  const parts = [`+${r.t}ms`, r.type];
  if (r.key !== undefined) parts.push(`key=${JSON.stringify(r.key)} code=${r.code || '∅'} kc=${r.keyCode}`);
  if (r.data !== undefined) parts.push(`data=${JSON.stringify(r.data)}`);
  if (r.inputType) parts.push(r.inputType);
  if (r.value !== undefined) parts.push(`valeur=${JSON.stringify(r.value)}`);
  if (r.composing) parts.push('IME');
  parts.push(`→ ${r.target}`);
  return parts.join('  ');
};

export default function PdaDebug() {
  const { token } = useContext(AuthContext);
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [recognized, setRecognized] = useState([]);
  const [sent, setSent] = useState(null);
  const t0 = useRef(performance.now());
  const listRef = useRef(null);

  useEffect(() => {
    const onEvent = (e) => setLogs(l => [...l.slice(-399), summarize(e, t0.current)]);
    EVENTS.forEach(ev => window.addEventListener(ev, onEvent, true));
    return () => EVENTS.forEach(ev => window.removeEventListener(ev, onEvent, true));
  }, []);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs]);

  // Le lecteur des apps PDA, tel quel : s'il se déclenche ici, il marchera là-bas.
  const onScan = useCallback((code) => {
    beep(true);
    setRecognized(r => [{ code, at: new Date().toLocaleTimeString('fr-FR') }, ...r].slice(0, 10));
  }, []);
  useScanner(onScan, true);

  const clear = () => {
    t0.current = performance.now();
    setLogs([]); setRecognized([]); setSent(null);
    document.querySelectorAll('[data-zone]').forEach(el => { el.value = ''; });
  };

  const send = async () => {
    setSent('…');
    try {
      await axios.post(`${API_URL}/picking/pda/debug-log`, {
        userAgent: navigator.userAgent,
        screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}`,
        standalone: window.matchMedia?.('(display-mode: standalone)').matches || false,
        recognized,
        logs,
      }, authHeaders(token));
      setSent('Envoyé ✓');
    } catch (err) {
      setSent(`Échec : ${err.response?.data?.error || err.message}`);
    }
  };

  const zone = (key, label, hint, extra = {}) => (
    <div style={{ background: C.white, borderRadius: 12, padding: 12, border: `1px solid ${C.greyB}` }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{label}</div>
      <div style={{ fontSize: 13, color: C.greyT, margin: '2px 0 8px' }}>{hint}</div>
      <input
        data-zone={key}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        placeholder="Toucher ici puis scanner"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 17, padding: 10, borderRadius: 8, border: `2px solid ${C.greyB}` }}
        {...extra}
      />
    </div>
  );

  return (
    <PdaLayout title="Diagnostic scan" onBack={() => navigate('/pda')} backLabel="Accueil">
      <div style={{ padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ background: C.violetL, borderRadius: 12, padding: 12, fontSize: 14, lineHeight: 1.45 }}>
          <strong>1.</strong> Sans rien toucher, scanner un article (c'est le cas des apps).<br />
          <strong>2.</strong> Puis scanner dans chacun des deux champs ci-dessous.<br />
          <strong>3.</strong> « Envoyer au serveur ».
        </div>

        <div style={{
          borderRadius: 12, padding: 12, fontWeight: 800, fontSize: 16,
          background: recognized.length ? C.greenL : C.amberL, color: recognized.length ? C.green : C.amber,
        }}>
          {recognized.length
            ? <>Reconnu par les apps : {recognized.map(r => `${r.code} (${r.at})`).join(' · ')}</>
            : 'Aucun scan reconnu par les apps pour l’instant'}
        </div>

        {zone('champ', 'Champ normal', 'Le clavier peut s’ouvrir : c’est normal ici.')}
        {zone('sans-clavier', 'Champ sans clavier', 'inputmode=none : le clavier ne devrait pas s’ouvrir.', { inputMode: 'none' })}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={send} style={{ ...pdaBtn(C.violet), flex: 1 }}>Envoyer au serveur</button>
          <button onClick={clear} style={{ ...pdaBtn(C.greyB, C.dark) }}>Effacer</button>
        </div>
        {sent && <div style={{ fontWeight: 700, color: sent.startsWith('Échec') ? C.red : C.green }}>{sent}</div>}

        <div style={{ fontSize: 12, color: C.greyT }}>{logs.length} événement(s) · {navigator.userAgent}</div>
        <div
          ref={listRef}
          style={{
            background: C.dark, color: '#D1FAE5', borderRadius: 10, padding: 10, height: 320, overflowY: 'auto',
            fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {logs.length === 0 ? 'En attente d’un scan…' : logs.map((r, i) => <div key={i}>{line(r)}</div>)}
        </div>
      </div>
    </PdaLayout>
  );
}
