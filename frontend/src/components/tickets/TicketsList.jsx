import { useState, useEffect, useCallback, useRef, useContext } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import StatusBadge from './StatusBadge';
import { TICKETS_COLOR, formatTicketId } from './ticketConstants';
import { formatDateUTC } from '../../utils/dateUtils';
import { useOpenTickets } from '../../context/OpenTicketsContext';
import { useTicketStatuses } from './useTicketStatuses';
import { AuthContext } from '../../context/AuthContext';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
  saphirF: '#003A56', vert: '#4AB866',
};

const API = '/api/sav';
const PAGE_SIZE = 50;

/* Styles de la barre d'actions groupées (boutons sombres + menus popover) */
const bulkBtnStyle = (busy) => ({
  background: 'rgba(255,255,255,0.12)', color: '#fff',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8,
  padding: '6px 14px', fontSize: 13, fontWeight: 700,
  cursor: busy ? 'not-allowed' : 'pointer', fontFamily: 'Lato, sans-serif',
});
const bulkMenuStyle = {
  position: 'absolute', bottom: 'calc(100% + 8px)', right: 0,
  background: '#fff', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.25)',
  border: '1px solid #E2E2E2', padding: 6, minWidth: 200, maxHeight: 280,
  overflowY: 'auto', zIndex: 50,
};
const bulkItemStyle = {
  display: 'block', width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderRadius: 6,
  padding: '8px 10px', fontSize: 13, color: '#2a2e38',
  cursor: 'pointer', fontFamily: 'Lato, sans-serif',
};

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* ─── Icônes canal ───────────────────────────────────────────────────────────── */
function IconMail() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={3} y={5} width={18} height={14} rx={2} /><path d="M3 7l9 6 9-6" />
    </svg>
  );
}
function IconForm() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={4} y={3} width={16} height={18} rx={2} /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function IconSort({ dir }) {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
      <path d="M3 5 L6 2 L9 5" stroke={dir === 'asc' ? C.grisTF : C.grisM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 7 L6 10 L9 7" stroke={dir === 'desc' ? C.grisTF : C.grisM} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconChevron() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="none">
      <path d="M2 4 L6 8 L10 4" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
function IconFilter() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={TICKETS_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h18M6 12h12M10 19h4"/>
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="#fff" stroke="none">
      <path d="M7 4v16l13-8z"/>
    </svg>
  );
}
function IconPlus({ color = '#fff' }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  );
}

/* ─── Checkbox ───────────────────────────────────────────────────────────────── */
function Checkbox({ checked, indeterminate, onChange }) {
  return (
    <span
      onClick={e => { e.stopPropagation(); onChange(); }}
      style={{
        width: 18, height: 18, borderRadius: 4,
        border: `1.5px solid ${checked || indeterminate ? TICKETS_COLOR : C.grisCL}`,
        background: checked || indeterminate ? TICKETS_COLOR : C.blanc,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', transition: 'all 0.15s', verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {checked && (
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.5 L5 9 L10 3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
      {indeterminate && !checked && (
        <svg width="11" height="3" viewBox="0 0 12 3" fill="none">
          <path d="M2 1.5 H10" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      )}
    </span>
  );
}

/* ─── Indicateur "il y a X" (se met à jour tout seul) ─────────────────────────── */
function timeAgo(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 5) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  return `il y a ${h} h`;
}

/* ─── Aperçu du message client (tooltip au survol, façon Zendesk) ─────────────── */
// La description peut contenir du HTML : on le décode et on retire les balises
// pour n'afficher que le texte. Tronqué côté CSS (line-clamp).
function plainPreview(html) {
  if (!html) return '';
  // decode des entités + suppression des balises via le parseur du navigateur
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

/* Tooltip rendu en portal (position fixed sous la ligne survolée) pour ne pas
   être coupé par l'overflow de la table. */
function RowPreview({ ticket, rect }) {
  if (!ticket || !rect) return null;
  const text = plainPreview(ticket.description);
  if (!text) return null;

  // Largeur du tooltip alignée sur la ligne, plafonnée. Positionné juste sous la
  // ligne ; bascule au-dessus s'il déborderait en bas de l'écran.
  const width = Math.min(560, Math.max(360, rect.width - 80));
  const left = Math.min(rect.left + 40, window.innerWidth - width - 16);
  const estHeight = 150;
  const below = rect.bottom + 8;
  const placeBelow = below + estHeight < window.innerHeight;
  const top = placeBelow ? below : rect.top - estHeight - 8;

  return createPortal(
    <div style={{
      position: 'fixed', left, top, width, zIndex: 900,
      background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
      boxShadow: '0 10px 32px rgba(0,0,0,0.16)', padding: '14px 16px',
      fontFamily: 'Lato, sans-serif', pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <StatusBadge status={ticket.sav_status} />
        <span style={{ fontSize: 12, color: C.grisM, fontWeight: 700 }}>
          Ticket {formatTicketId(ticket.id)}
        </span>
      </div>
      <div style={{
        fontSize: 13, color: C.grisTF, lineHeight: 1.5,
        display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      }}>
        {text}
      </div>
    </div>,
    document.body
  );
}

/* ─── Contrôle autorefresh : toggle ON/OFF + fraîcheur + refresh manuel ───────── */
function AutoRefreshControl({ autoRefresh }) {
  const { enabled, setEnabled, lastRefresh, refreshNow } = autoRefresh || {};
  const [, force] = useState(0);

  // Re-render chaque seconde pour rafraîchir le libellé "il y a X"
  useEffect(() => {
    const id = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!autoRefresh) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11.5, color: C.grisM, fontWeight: 600, whiteSpace: 'nowrap' }}>
        Maj {timeAgo(lastRefresh)}
      </span>
      <button
        onClick={() => refreshNow?.()}
        title="Rafraîchir maintenant"
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
          background: C.blanc, border: `1px solid ${C.grisCL}`, color: C.grisF,
        }}
        onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
        onMouseLeave={e => e.currentTarget.style.background = C.blanc}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
      <button
        onClick={() => setEnabled(v => !v)}
        title={enabled ? 'Autorefresh activé (cliquer pour couper)' : 'Autorefresh coupé (cliquer pour activer)'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lato, sans-serif',
          background: enabled ? '#E5F4EB' : C.grisTL,
          color: enabled ? '#2A8049' : C.grisM,
          border: `1px solid ${enabled ? '#B6E2C6' : C.grisCL}`,
        }}
      >
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: enabled ? '#2A8049' : C.grisM,
          boxShadow: enabled ? '0 0 0 3px rgba(42,128,73,0.15)' : 'none',
        }} />
        {enabled ? 'Auto' : 'Manuel'}
      </button>
    </div>
  );
}

/* ─── Modale de fusion groupée ─────────────────────────────────────────────────
   Tous les tickets sélectionnés sont SOURCES, fusionnés dans une seule CIBLE.
   La cible peut être l'un des sélectionnés (radio) ou un autre ticket (recherche). */
function BulkMergeModal({ sources, onClose, onDone }) {
  const [target, setTarget] = useState(sources[0] || null);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [merging, setMerging] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total }
  const [error, setError] = useState('');
  const [confirmDiff, setConfirmDiff] = useState(false);
  const searchTimer = useRef();

  const sourceIds = new Set(sources.map(s => s.id));

  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim()) { setSearchResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}?search=${encodeURIComponent(query.trim())}&limit=8`);
        const data = await res.json();
        if (data.success) setSearchResults((data.tickets || []).filter(t => !t.merged_into_id));
      } catch { /* silencieux */ }
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  // Sources réelles = tous les sélectionnés sauf la cible (si la cible est l'un d'eux)
  const realSources = sources.filter(s => s.id !== target?.id);
  const canMerge = !!target && realSources.length > 0 && !merging;

  // Demandeurs différents ? Compare chaque source à la cible (email sinon nom).
  const tgtEmail = (target?.customer_email || '').trim().toLowerCase();
  const tgtName = (target?.customer_name || '').trim().toLowerCase();
  const hasDiffRequester = !!target && realSources.some(s => {
    const sEmail = (s.customer_email || '').trim().toLowerCase();
    if (sEmail && tgtEmail) return sEmail !== tgtEmail;
    const sName = (s.customer_name || '').trim().toLowerCase();
    if (sName && tgtName) return sName !== tgtName;
    return false;
  });

  const doMerge = async () => {
    if (!canMerge) return;
    if (hasDiffRequester && !confirmDiff) { setConfirmDiff(true); return; }
    setMerging(true);
    setError('');
    let done = 0;
    setProgress({ done: 0, total: realSources.length });
    try {
      // Fusion séquentielle (l'ordre n'a pas d'importance, chaque source → cible)
      for (const src of realSources) {
        const res = await fetch(`${API}/${src.id}/merge`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ target_id: target.id }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(`Ticket #${src.id} : ${data.error || 'échec'}`);
        done += 1;
        setProgress({ done, total: realSources.length });
      }
      onDone(target.id);
    } catch (e) {
      setError(e.message);
      setMerging(false);
    }
  };

  const Pick = ({ t, isSource }) => {
    const selected = t.id === target?.id;
    return (
      <button
        onClick={() => { setTarget(t); setError(''); setConfirmDiff(false); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
          background: selected ? '#EAF2FF' : C.blanc,
          border: `1px solid ${selected ? '#0071EB' : C.grisCL}`,
          borderRadius: 8, padding: '8px 11px', cursor: 'pointer',
          fontFamily: 'Lato, sans-serif', marginBottom: 6,
        }}
      >
        <span style={{
          width: 15, height: 15, borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${selected ? '#0071EB' : C.grisM}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {selected && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#0071EB' }} />}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: selected ? '#0071EB' : C.grisF }}>{formatTicketId(t.id)}</span>
        <span style={{ fontSize: 12, color: C.grisF, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {t.subject || '—'}
        </span>
        {t.customer_name && (
          <span style={{ fontSize: 11, color: C.grisM, whiteSpace: 'nowrap' }}>{t.customer_name}</span>
        )}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,24,33,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: C.blanc, borderRadius: 14, width: 'min(540px, 92vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 18px 50px rgba(0,0,0,0.3)', fontFamily: 'Lato, sans-serif', padding: 22 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <strong style={{ fontSize: 16, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>
            Fusionner {sources.length} ticket{sources.length > 1 ? 's' : ''}
          </strong>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 20, color: C.grisM, lineHeight: 1 }}>×</button>
        </div>
        <p style={{ fontSize: 12.5, color: C.grisF, lineHeight: 1.5, margin: '6px 0 16px' }}>
          Choisissez le ticket <strong>cible</strong> (celui qu'on garde). Les autres seront
          fusionnés dedans puis <strong>fermés</strong>. Action irréversible.
        </p>

        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          Cible parmi la sélection
        </div>
        {sources.map(s => <Pick key={s.id} t={s} isSource />)}

        <div style={{ fontSize: 10.5, fontWeight: 800, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '14px 0 8px' }}>
          …ou un autre ticket
        </div>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="N° ticket, nom, email, commande, suivi, texte…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: `1px solid ${C.grisCL}`, borderRadius: 8, fontSize: 13, fontFamily: 'Lato, sans-serif', marginBottom: 8, outline: 'none' }}
        />
        {searchResults.filter(t => !sourceIds.has(t.id)).map(t => <Pick key={t.id} t={t} />)}

        {error && <div style={{ fontSize: 12.5, color: '#B71D1D', fontWeight: 600, margin: '8px 0' }}>{error}</div>}
        {progress && merging && (
          <div style={{ fontSize: 12.5, color: C.grisF, fontWeight: 600, margin: '8px 0' }}>
            Fusion {progress.done}/{progress.total}…
          </div>
        )}

        {confirmDiff ? (
          <div style={{ marginTop: 16, background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
              <span style={{ fontSize: 16 }}>⚠</span>
              <strong style={{ fontSize: 13, color: '#9A3412', fontWeight: 800 }}>Demandeurs différents</strong>
            </div>
            <div style={{ fontSize: 12.5, color: '#7C2D12', lineHeight: 1.5, marginBottom: 12 }}>
              Vous fusionnez des tickets de <strong>demandeurs différents</strong> dans
              {' '}<strong>{target?.customer_name || target?.customer_email || formatTicketId(target?.id)}</strong>.
              Êtes-vous sûr ?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={() => setConfirmDiff(false)} disabled={merging} style={{ background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, color: C.grisF, cursor: 'pointer', fontFamily: 'Lato, sans-serif' }}>Non</button>
              <button onClick={doMerge} disabled={merging} style={{ background: '#EA580C', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 800, color: '#fff', cursor: merging ? 'wait' : 'pointer', fontFamily: 'Lato, sans-serif' }}>{merging ? 'Fusion…' : 'Oui, fusionner'}</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button onClick={onClose} style={{ background: C.grisTL, border: `1px solid ${C.grisCL}`, borderRadius: 8, padding: '9px 16px', fontSize: 13, fontWeight: 700, color: C.grisF, cursor: 'pointer', fontFamily: 'Lato, sans-serif' }}>Annuler</button>
            <button onClick={doMerge} disabled={!canMerge} style={{ background: canMerge ? '#0071EB' : C.grisCL, border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 800, color: '#fff', cursor: canMerge ? 'pointer' : 'not-allowed', fontFamily: 'Lato, sans-serif' }}>
              {merging ? 'Fusion…' : target ? `Fusionner ${realSources.length} dans ${formatTicketId(target.id)}` : 'Choisir une cible'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Composant principal ─────────────────────────────────────────────────────── */
export default function TicketsList({ activeView, views = [], onRefresh, refreshTick, autoRefresh, onBusyChange, isMobile = false, onOpenViews }) {
  const navigate = useNavigate();
  const { openTicket, startPlay, openNewDraft } = useOpenTickets();
  const [tickets, setTickets] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  // Ne montrer l'écran "Chargement…" qu'au tout premier fetch (ou changement de
  // vue) : les refreshs (autorefresh, retour de détail) se font en silence pour
  // ne pas faire clignoter la table.
  const hasLoadedRef = useRef(false);
  const [sort, setSort] = useState({ key: 'updated', dir: 'desc' });
  const [selected, setSelected] = useState(new Set());
  const [bulkMergeOpen, setBulkMergeOpen] = useState(false);
  const [bulkMenu, setBulkMenu] = useState(null); // 'assign' | 'status' | null
  const [bulkBusy, setBulkBusy] = useState(false);
  const [agents, setAgents] = useState([]);
  // Aperçu du message au survol d'une ligne (façon Zendesk) : { ticket, rect }
  const [preview, setPreview] = useState(null);
  const previewTimer = useRef();
  const { token } = useContext(AuthContext);
  const { statuses: allStatuses } = useTicketStatuses();

  // Nettoyer le timer d'aperçu au démontage
  useEffect(() => () => clearTimeout(previewTimer.current), []);

  // Charger les agents pour l'assignation groupée
  useEffect(() => {
    if (!token) return;
    fetch('/api/users/agents', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.success && d.users) setAgents(d.users); })
      .catch(() => {});
  }, [token]);

  // Signaler à l'autorefresh qu'on est "occupé" (ne pas rafraîchir sous les
  // doigts de l'agent) : sélection en cours, menu ouvert, modale ou action.
  useEffect(() => {
    const busy = selected.size > 0 || !!bulkMenu || bulkMergeOpen || bulkBusy;
    onBusyChange?.(busy);
  }, [selected.size, bulkMenu, bulkMergeOpen, bulkBusy, onBusyChange]);

  // Fermer les menus d'action groupée au clic extérieur / Échap
  useEffect(() => {
    if (!bulkMenu) return;
    const onDoc = (e) => { if (!e.target.closest?.('[data-bulk-menu]')) setBulkMenu(null); };
    const onEsc = (e) => { if (e.key === 'Escape') setBulkMenu(null); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
  }, [bulkMenu]);

  // activeView est maintenant l'objet vue complet (avec .statuses tableau)
  const statusesFilter = activeView?.statuses || []; // [] = tous

  /* ── Fetch tickets ── */
  const fetchTickets = useCallback(async () => {
    if (!activeView) return;
    // "Chargement…" seulement tant qu'on n'a jamais affiché de liste ; ensuite
    // on rafraîchit en arrière-plan sans vider la table (pas de flash).
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      // Ajouter les statuts comme paramètres répétés (Express qs les parse en tableau)
      statusesFilter.forEach(s => params.append('sav_statuses', s));
      const res = await fetch(`${API}?${params}`);
      const data = await res.json();
      if (data.success) { setTickets(data.tickets); setTotal(data.total); }
    } finally {
      hasLoadedRef.current = true;
      setLoading(false);
    }
  }, [activeView, statusesFilter.join(','), page, refreshTick]);

  useEffect(() => { fetchTickets(); }, [fetchTickets]);
  // Changement de vue : on repart d'un état "premier chargement" pour montrer
  // l'indicateur (le contenu change complètement, le flash est légitime ici).
  useEffect(() => { hasLoadedRef.current = false; setPage(0); setSelected(new Set()); }, [activeView?.id]);

  /* ── Tri local ── */
  const sortedTickets = [...tickets].sort((a, b) => {
    let va = a[sort.key] ?? '', vb = b[sort.key] ?? '';
    if (sort.key === 'id') { va = Number(va); vb = Number(vb); }
    if (sort.key === 'updated_at' || sort.key === 'created_at') {
      va = new Date(va); vb = new Date(vb);
    }
    if (va < vb) return sort.dir === 'asc' ? -1 : 1;
    if (va > vb) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const onSort = (key) => setSort(prev => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  const onToggle = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const onToggleAll = () => setSelected(prev => prev.size === tickets.length ? new Set() : new Set(tickets.map(t => t.id)));

  // Action groupée : applique une requête à chaque ticket sélectionné (séquentiel).
  const runBulk = useCallback(async (makeRequest) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      for (const id of ids) {
        const { url, options } = makeRequest(id);
        await fetch(url, options).catch(() => {});
      }
      setSelected(new Set());
      setBulkMenu(null);
      fetchTickets();
      onRefresh?.();
    } finally {
      setBulkBusy(false);
    }
  }, [selected, fetchTickets, onRefresh]);

  const bulkAssign = (agentId) => runBulk(id => ({
    url: `${API}/${id}`,
    options: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_to_id: agentId }),
    },
  }));

  const bulkStatus = (statusValue) => runBulk(id => ({
    url: `${API}/${id}/status`,
    options: {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sav_status: statusValue }),
    },
  }));

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /* ── Styles entête colonne ── */
  const thStyle = (key, align = 'left', width) => ({
    padding: '14px 16px',
    fontSize: 12, fontWeight: 700, color: C.grisF,
    textAlign: align, whiteSpace: 'nowrap',
    background: C.blanc,
    borderBottom: `1px solid ${C.grisCL}`,
    position: 'sticky', top: 0, zIndex: 2,
    cursor: key ? 'pointer' : 'default',
    width, userSelect: 'none',
  });
  const cell = { padding: '14px 16px', borderBottom: `1px solid ${C.grisCL}`, fontSize: 13.5, color: C.grisTF };

  return (
    <main className="main-scroll" style={{
      flex: 1, minWidth: 0, overflowY: 'auto', height: isMobile ? '100%' : '100vh',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'Lato, sans-serif', color: C.grisTF,
    }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header style={{
        background: C.blanc, borderBottom: `1px solid ${C.grisCL}`,
        padding: isMobile ? '0 14px' : '0 28px', minHeight: 58,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 20, gap: 12, flexShrink: 0,
      }}>
        {isMobile ? (
          /* Mobile : bouton « Vues » (ouvre le tiroir) avec le nom de la vue active */
          <button
            onClick={onOpenViews}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0,
              background: C.grisTL, border: `1px solid ${C.grisCL}`, borderRadius: 8,
              padding: '8px 12px', fontSize: 14, fontWeight: 800, color: C.grisTF,
              cursor: 'pointer', fontFamily: "'Tilt Warp', cursive",
            }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={TICKETS_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {activeView?.label || 'Vues'}
            </span>
          </button>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Icône app */}
            <div style={{
              width: 30, height: 30, borderRadius: 8, flexShrink: 0,
              background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.2)})`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 12px ${TICKETS_COLOR}38, 0 1px 0 rgba(255,255,255,0.35) inset`,
            }}>
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/><path d="M8 9h8M8 13h5"/>
              </svg>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: C.grisTF, fontFamily: "'Tilt Warp', cursive" }}>Tickets</span>
            <span style={{ color: C.grisCL }}>/</span>
            <span style={{ fontSize: 13, color: C.grisF, fontWeight: 600 }}>{activeView?.label || 'Tous'}</span>
          </div>
        )}
        {/* Bouton Nouveau ticket (icône seule sur mobile pour gagner de la place) */}
        <button
          onClick={() => openNewDraft()}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0,
            background: `linear-gradient(155deg, ${TICKETS_COLOR}, ${shade(TICKETS_COLOR, -0.18)})`,
            color: '#fff', border: 'none',
            borderRadius: 8, padding: isMobile ? '9px 11px' : '8px 14px', fontSize: 13, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'Lato, sans-serif',
            boxShadow: `0 4px 12px ${TICKETS_COLOR}40, 0 1px 0 rgba(255,255,255,0.4) inset`,
            transition: 'transform 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
          title="Nouveau ticket"
        >
          <IconPlus />{!isMobile && ' Nouveau ticket'}
        </button>
      </header>

      {/* ── Vue header ──────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? '16px 14px 0' : '28px 28px 0', flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16, flexWrap: 'wrap', marginBottom: isMobile ? 14 : 20,
        }}>
          <div>
            <h1 style={{
              fontSize: isMobile ? 20 : 26, fontWeight: 800, color: C.grisTF,
              fontFamily: "'Tilt Warp', cursive",
              letterSpacing: '-0.4px', margin: '0 0 4px',
            }}>{activeView?.label || 'Tous les tickets'}</h1>
            <div style={{ fontSize: 13, color: C.grisM, fontWeight: 600 }}>
              <strong style={{ color: C.grisTF }}>{total}</strong> ticket{total > 1 ? 's' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AutoRefreshControl autoRefresh={autoRefresh} />
            <button
              onClick={() => {
                const ids = sortedTickets.map(t => t.id);
                if (ids.length === 0) return;
                startPlay({
                  queue: ids,
                  viewId: activeView?.id || null,
                  viewStatuses: statusesFilter,
                });
              }}
              disabled={sortedTickets.length === 0}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: sortedTickets.length === 0 ? C.grisM : C.vert, color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 14px', fontSize: 13, fontWeight: 800,
                cursor: sortedTickets.length === 0 ? 'not-allowed' : 'pointer', fontFamily: 'Lato, sans-serif',
                boxShadow: sortedTickets.length === 0 ? 'none' : '0 2px 6px rgba(74,184,102,0.35), 0 1px 0 rgba(255,255,255,0.3) inset',
                transition: 'transform 0.15s',
              }}
              onMouseEnter={e => { if (sortedTickets.length > 0) e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
              title={sortedTickets.length === 0 ? 'Aucun ticket à traiter' : `Lancer le mode Play (${sortedTickets.length} tickets)`}
            >
              <IconPlay /> Play
            </button>
          </div>
        </div>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div style={{ padding: isMobile ? '0 14px 18px' : '0 28px 28px', flex: 1 }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.grisM, fontSize: 14 }}>
            Chargement…
          </div>
        ) : tickets.length === 0 ? (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: 200, color: C.grisM, fontSize: 14, gap: 8,
            background: C.blanc, borderRadius: 12, border: `1px solid ${C.grisCL}`,
          }}>
            <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke={C.grisCL} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Aucun ticket dans cette vue
          </div>
        ) : isMobile ? (
          /* ── Mobile : cartes verticales (le tableau ne tient pas) ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sortedTickets.map(t => (
              <div
                key={t.id}
                onClick={() => openTicket(t)}
                style={{
                  background: C.blanc, borderRadius: 12,
                  border: `1px solid ${C.grisCL}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                  padding: '12px 14px', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}
              >
                {/* Ligne 1 : statut + ID + date MAJ */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <StatusBadge status={t.sav_status} />
                  <span style={{ color: C.grisF, fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontSize: 12.5 }}>
                    {formatTicketId(t.id)}
                  </span>
                  {t.has_duplicate_warning && (
                    <span style={{
                      background: '#FEE2E2', color: '#B71D1D', border: '1px solid #FECACA',
                      borderRadius: 4, padding: '1px 6px', fontSize: 10.5, fontWeight: 800,
                    }}>⚠ Doublon</span>
                  )}
                  <span style={{ marginLeft: 'auto', color: C.grisM, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                    {formatDateUTC(t.updated_at, { time: true })}
                  </span>
                </div>
                {/* Ligne 2 : sujet */}
                <div style={{ fontWeight: 700, fontSize: 14.5, color: C.grisTF, lineHeight: 1.3 }}>
                  {t.subject || '—'}
                </div>
                {/* Ligne 3 : demandeur + canal */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: C.grisM }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: C.grisF, fontWeight: 600 }}>
                    {t.source === 'gravity_form' ? <IconForm /> : <IconMail />}
                    {t.customer_name || t.customer_email || '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{
            background: C.blanc, borderRadius: 12,
            border: `1px solid ${C.grisCL}`,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {/* Checkbox all */}
                    <th style={{ ...thStyle(null), padding: '14px 12px 14px 16px', width: 40 }}>
                      <Checkbox
                        checked={selected.size === tickets.length && tickets.length > 0}
                        indeterminate={selected.size > 0 && selected.size < tickets.length}
                        onChange={onToggleAll}
                      />
                    </th>
                    {[
                      { label: 'Statut du ticket', key: 'sav_status' },
                      { label: 'ID', key: 'id', width: 70 },
                      { label: 'Sujet', key: 'subject' },
                      { label: 'Demandeur', key: 'customer_name' },
                      { label: 'Canal YV', key: 'source' },
                      { label: 'Créé', key: 'created_at' },
                      { label: 'Mis à jour', key: 'updated_at' },
                    ].map(col => (
                      <th key={col.key} style={thStyle(col.key, 'left', col.width)} onClick={() => onSort(col.key)}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          {col.label}
                          <IconSort dir={sort.key === col.key ? sort.dir : null} />
                        </span>
                      </th>
                    ))}
                    {/* Chevron */}
                    <th style={{ ...thStyle(null), width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {sortedTickets.map(t => {
                    const isSel = selected.has(t.id);
                    return (
                      <tr
                        key={t.id}
                        onClick={e => openTicket(t, { background: e.metaKey || e.ctrlKey })}
                        onMouseDown={e => {
                          // Middle-click = ouvrir en arrière-plan
                          if (e.button === 1) { e.preventDefault(); openTicket(t, { background: true }); }
                        }}
                        style={{
                          background: isSel ? `rgba(8,145,178,0.06)` : 'transparent',
                          cursor: 'pointer', transition: 'background 0.12s',
                        }}
                        onMouseEnter={e => {
                          if (!isSel) e.currentTarget.style.background = '#F8FBFD';
                          // Aperçu du message après un court délai (évite le spam au survol rapide)
                          const row = e.currentTarget;
                          clearTimeout(previewTimer.current);
                          previewTimer.current = setTimeout(() => {
                            setPreview({ ticket: t, rect: row.getBoundingClientRect() });
                          }, 350);
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = isSel ? `rgba(8,145,178,0.06)` : 'transparent';
                          clearTimeout(previewTimer.current);
                          setPreview(p => (p && p.ticket.id === t.id ? null : p));
                        }}
                      >
                        {/* Checkbox */}
                        <td style={{ ...cell, padding: '14px 12px 14px 16px', width: 40 }}
                          onClick={e => { e.stopPropagation(); onToggle(t.id); }}>
                          <Checkbox checked={isSel} onChange={() => onToggle(t.id)} />
                        </td>
                        {/* Statut */}
                        <td style={cell}><StatusBadge status={t.sav_status} /></td>
                        {/* ID */}
                        <td style={{ ...cell, color: C.grisF, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {formatTicketId(t.id)}
                        </td>
                        {/* Sujet */}
                        <td style={{ ...cell, maxWidth: 420 }}>
                          {t.has_duplicate_warning && (
                            <span
                              title={`Doublon potentiel : ${(t.duplicate_candidates || []).length} autre(s) ticket(s) du même client (et même commande si renseignée).`}
                              style={{
                                display: 'inline-block', marginRight: 8,
                                background: '#FEE2E2', color: '#B71D1D',
                                border: '1px solid #FECACA', borderRadius: 4,
                                padding: '1px 6px', fontSize: 10.5, fontWeight: 800,
                                verticalAlign: 'middle', whiteSpace: 'nowrap',
                              }}
                            >⚠ Doublon</span>
                          )}
                          <span style={{
                            display: 'inline-block',
                            maxWidth: t.has_duplicate_warning ? 'calc(100% - 80px)' : '100%',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            fontWeight: 500, verticalAlign: 'middle',
                          }}>
                            {t.subject || '—'}
                          </span>
                        </td>
                        {/* Demandeur */}
                        <td style={cell}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: C.grisTF }}>{t.customer_name || '—'}</div>
                          <div style={{ fontSize: 11.5, color: C.grisM }}>{t.customer_email}</div>
                        </td>
                        {/* Canal */}
                        <td style={cell}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: C.grisF }}>
                            {t.source === 'gravity_form' ? <IconForm /> : <IconMail />}
                            {t.source === 'gravity_form' ? 'Formulaire' : 'E-mail'}
                          </span>
                        </td>
                        {/* Créé */}
                        <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                          {formatDateUTC(t.created_at, { time: false })}
                        </td>
                        {/* Mis à jour */}
                        <td style={{ ...cell, color: C.grisF, whiteSpace: 'nowrap', fontSize: 13 }}>
                          {formatDateUTC(t.updated_at, { time: true })}
                        </td>
                        {/* Chevron */}
                        <td style={{ ...cell, width: 30, color: C.grisM, textAlign: 'center' }}>
                          <IconChevron />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, cursor: page === 0 ? 'not-allowed' : 'pointer', color: C.grisF, fontSize: 13 }}>
              ← Préc.
            </button>
            <span style={{ fontSize: 13, color: C.grisM }}>{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              style={{ padding: '5px 14px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer', color: C.grisF, fontSize: 13 }}>
              Suiv. →
            </button>
          </div>
        )}

        {/* ── Barre de sélection ── */}
        {selected.size > 0 && (
          <div style={{
            position: 'sticky', bottom: 16, marginTop: 16,
            background: C.saphirF, color: '#fff',
            borderRadius: 12, padding: '12px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 16,
            boxShadow: '0 8px 24px rgba(0,58,86,0.35)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {selected.size} ticket{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => { setBulkMenu(null); setBulkMergeOpen(true); }}
                disabled={bulkBusy}
                title="Fusionner les tickets sélectionnés dans une seule cible"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.18)', color: '#fff',
                  border: '1px solid rgba(255,255,255,0.3)', borderRadius: 8,
                  padding: '6px 14px', fontSize: 13, fontWeight: 800,
                  cursor: bulkBusy ? 'not-allowed' : 'pointer', fontFamily: 'Lato, sans-serif',
                }}
              >🔀 Fusionner</button>

              {/* Assigner */}
              <div data-bulk-menu style={{ position: 'relative' }}>
                <button
                  onClick={() => setBulkMenu(m => m === 'assign' ? null : 'assign')}
                  disabled={bulkBusy}
                  style={bulkBtnStyle(bulkBusy)}
                >Assigner ▾</button>
                {bulkMenu === 'assign' && (
                  <div style={bulkMenuStyle}>
                    <button onClick={() => bulkAssign(null)} style={bulkItemStyle}>
                      <span style={{ color: C.grisM }}>Désassigner</span>
                    </button>
                    {agents.length === 0 && (
                      <div style={{ ...bulkItemStyle, color: C.grisM, cursor: 'default' }}>Aucun agent</div>
                    )}
                    {agents.map(a => (
                      <button key={a.id} onClick={() => bulkAssign(a.id)} style={bulkItemStyle}>
                        {a.name || a.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Changer statut */}
              <div data-bulk-menu style={{ position: 'relative' }}>
                <button
                  onClick={() => setBulkMenu(m => m === 'status' ? null : 'status')}
                  disabled={bulkBusy}
                  style={bulkBtnStyle(bulkBusy)}
                >Changer statut ▾</button>
                {bulkMenu === 'status' && (
                  <div style={bulkMenuStyle}>
                    {allStatuses.length === 0 && (
                      <div style={{ ...bulkItemStyle, color: C.grisM, cursor: 'default' }}>Aucun statut</div>
                    )}
                    {allStatuses.map(s => (
                      <button key={s.value} onClick={() => bulkStatus(s.value)} style={bulkItemStyle}>
                        <span style={{
                          display: 'inline-block', width: 9, height: 9, borderRadius: '50%',
                          background: s.bg_color || C.grisCL, marginRight: 8, verticalAlign: 'middle',
                          border: `1px solid ${s.text_color || C.grisM}`,
                        }} />
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Marquer résolu (action directe → statut 'terminé') */}
              <button
                onClick={() => bulkStatus('terminé')}
                disabled={bulkBusy}
                style={bulkBtnStyle(bulkBusy)}
              >{bulkBusy ? 'Application…' : 'Marquer résolu'}</button>

              <button onClick={() => { setBulkMenu(null); setSelected(new Set()); }} disabled={bulkBusy} style={{
                background: 'transparent', color: 'rgba(255,255,255,0.7)',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
                padding: '6px 14px', fontSize: 13, fontWeight: 700,
                cursor: bulkBusy ? 'not-allowed' : 'pointer', fontFamily: 'Lato, sans-serif',
              }}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {bulkMergeOpen && (
        <BulkMergeModal
          sources={tickets.filter(t => selected.has(t.id))}
          onClose={() => setBulkMergeOpen(false)}
          onDone={() => {
            setBulkMergeOpen(false);
            setSelected(new Set());
            fetchTickets();
            onRefresh?.();
          }}
        />
      )}

      {/* Aperçu du message au survol (caché pendant une sélection/action groupée) */}
      {selected.size === 0 && !bulkMergeOpen && (
        <RowPreview ticket={preview?.ticket} rect={preview?.rect} />
      )}
    </main>
  );
}
