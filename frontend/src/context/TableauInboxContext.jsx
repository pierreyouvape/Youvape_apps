import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AuthContext } from './AuthContext';
import { tableauApi, noteColor, formatDue, TABLEAU_COLOR, apiError } from '../components/tableau/tableauShared';

/**
 * Notifications de l'app Tableau, visibles depuis TOUTES les apps :
 *   - post-it reçu (à accepter ou refuser) ;
 *   - réponse à un envoi (accepté / refusé) ;
 *   - rappel d'une tâche récurrente arrivé à son heure.
 *
 * Monté une fois dans App.jsx (et pas dans AppShell, qui est remonté à chaque
 * changement d'app) : la boîte est relue toutes les minutes, et la pastille du
 * lanceur, celle de la barre latérale et la page Tableau lisent le même état.
 * Pas d'interrogation sans le droit `tableau` : le routeur répondrait 403.
 */

const EMPTY = { incoming: [], answers: [], sent: [], reminders: [] };
const POLL_MS = 60 * 1000;
const MAX_TOASTS = 3;

const TableauInboxContext = createContext({ inbox: EMPTY, count: 0, refresh: () => {} });

export const useTableauInbox = () => useContext(TableauInboxContext);

export function TableauInboxProvider({ children }) {
  const { token, permissions, isSuperAdmin } = useContext(AuthContext);
  const enabled = !!token && (isSuperAdmin || permissions?.tableau?.read === true);
  const [inbox, setInbox] = useState(EMPTY);

  const refresh = useCallback(async () => {
    if (!enabled) { setInbox(EMPTY); return; }
    try {
      setInbox(await tableauApi.inbox());
    } catch {
      // Réseau ou redémarrage du backend : on garde l'état et on retentera
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
    if (!enabled) return undefined;
    const t = setInterval(refresh, POLL_MS);
    // Retour sur l'onglet après une pause : pas d'attente d'une minute
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [refresh, enabled]);

  const count = inbox.incoming.length + inbox.answers.length + inbox.reminders.length;

  return (
    <TableauInboxContext.Provider value={{ inbox, count, refresh }}>
      {children}
      {enabled && <TableauToasts inbox={inbox} refresh={refresh} />}
    </TableauInboxContext.Provider>
  );
}

/* ─── Toasts ─────────────────────────────────────────────── */

const btn = (primary) => ({
  border: 'none', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 700,
  cursor: 'pointer', fontFamily: 'inherit',
  background: primary ? TABLEAU_COLOR : '#F3F4F6', color: primary ? '#fff' : '#374151',
});

const preview = (text) => {
  const s = (text || '').trim().replace(/\s+/g, ' ');
  if (!s) return '(post-it vide)';
  return s.length > 90 ? `${s.slice(0, 90)}…` : s;
};

function TableauToasts({ inbox, refresh }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Toasts fermés d'un « × » : masqués pour la session, la donnée reste dans la
  // boîte (pastille, bandeau de la page Tableau).
  const [hidden, setHidden] = useState(() => new Set());
  const [error, setError] = useState(null);

  // Dans l'app Tableau, le bandeau de la page dit déjà tout
  if (pathname.startsWith('/tableau')) return null;

  const hide = (key) => setHidden((prev) => new Set(prev).add(key));
  const run = (fn) => async () => {
    setError(null);
    try { await fn(); } catch (e) { setError(apiError(e)); }
    refresh();
  };

  const toasts = [
    ...inbox.incoming.map((t) => ({
      key: `in-${t.id}`, color: t.color,
      title: `${t.from_name} vous envoie ${t.mode === 'copy' ? 'une copie de post-it' : 'un post-it'}`,
      body: preview(t.content),
      actions: [
        { label: 'Voir', primary: true, onClick: () => navigate('/tableau/epingle') },
      ],
    })),
    ...inbox.answers.map((t) => ({
      key: `ans-${t.id}`, color: t.color,
      title: `${t.to_name} a ${t.status === 'accepted' ? 'accepté' : 'refusé'} votre ${t.mode === 'copy' ? 'copie' : 'post-it'}`,
      body: t.status === 'refused' && t.mode === 'move'
        ? `Il est revenu sur votre tableau. « ${preview(t.content)} »`
        : `« ${preview(t.content)} »`,
      actions: [{ label: 'OK', primary: true, onClick: run(() => tableauApi.seen(t.id)) }],
    })),
    ...inbox.reminders.map((t) => ({
      key: `rem-${t.id}-${t.next_due}`, color: null,
      title: `Rappel : ${t.title}`,
      body: `Prévu ${formatDue(t.next_due, t.due_time)}`,
      actions: [
        { label: 'Fait', primary: true, onClick: run(() => tableauApi.done(t.id)) },
        { label: 'OK', onClick: run(() => tableauApi.dismissReminder(t.id)) },
      ],
    })),
  ].filter((t) => !hidden.has(t.key));

  if (!toasts.length) return null;
  const shown = toasts.slice(0, MAX_TOASTS);
  const more = toasts.length - shown.length;

  return (
    <div style={{
      position: 'fixed', right: 16, bottom: 16, zIndex: 99998,
      display: 'flex', flexDirection: 'column', gap: 10,
      width: 340, maxWidth: 'calc(100vw - 32px)', fontFamily: "'Lato', sans-serif",
    }}>
      {shown.map((t) => (
        <div key={t.key} style={{
          background: '#fff', borderRadius: 12, padding: '12px 14px',
          boxShadow: '0 10px 28px rgba(0,0,0,0.20)',
          borderLeft: `5px solid ${t.color ? noteColor(t.color).bar : TABLEAU_COLOR}`,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: '#1F2937' }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: '#4B5563', marginTop: 3, wordBreak: 'break-word' }}>{t.body}</div>
            </div>
            <button onClick={() => hide(t.key)} title="Masquer" style={{
              background: 'none', border: 'none', fontSize: 18, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer', padding: 0,
            }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end' }}>
            {t.actions.map((a) => (
              <button key={a.label} onClick={a.onClick} style={btn(a.primary)}>{a.label}</button>
            ))}
          </div>
        </div>
      ))}
      {more > 0 && (
        <button onClick={() => navigate('/tableau/epingle')} style={{ ...btn(false), alignSelf: 'flex-end' }}>
          + {more} autre{more > 1 ? 's' : ''} — ouvrir Tableau
        </button>
      )}
      {error && <div style={{ fontSize: 12, color: '#B91C1C', textAlign: 'right' }}>{error}</div>}
    </div>
  );
}
