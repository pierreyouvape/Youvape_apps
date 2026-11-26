import { useCallback, useEffect, useState } from 'react';
import { tachesApi, apiError, ago, M } from './tachesShared';
import { Avatar } from './tachesUi';

const TABS = [
  { key: 'all', label: 'Tous' },
  { key: 'mention', label: 'M\'a mentionné' },
  { key: 'assigned', label: 'M\'a été attribué' },
];

const VERB = {
  mention: '@ Vous a mentionné(e) dans un commentaire',
  assigned: 'Vous a attribué',
  unblocked: 'Votre étape est débloquée',
  comment: 'A commenté une tâche que vous suivez',
};

/**
 * Panneau « Notifications » (cloche), comme Monday : onglets Tous / M'a
 * mentionné / M'a été attribué, recherche, « non lu uniquement ». Cliquer une
 * notification la marque lue et ouvre la tâche.
 */
export default function NotificationsPanel({ onClose, onOpen, onUnread }) {
  const [tab, setTab] = useState('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [q, setQ] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const d = await tachesApi.notifications({ tab, unread: unreadOnly ? 1 : 0, q: q.trim() || undefined });
      setData(d);
      onUnread(d.unread);
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, [tab, unreadOnly, q, onUnread]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const open = async (n) => {
    if (!n.read) {
      try { onUnread((await tachesApi.readNotification(n.id)).unread); } catch { /* lecture seule ratée : on ouvre quand même */ }
    }
    if (n.task_id) onOpen(n.task_id);
    onClose();
  };
  const toggleRead = async (n, e) => {
    e.stopPropagation();
    try {
      onUnread((await tachesApi.readNotification(n.id, !n.read)).unread);
      load();
    } catch (err) { setError(apiError(err)); }
  };
  const readAll = async () => {
    try {
      await tachesApi.readAllNotifications();
      load();
    } catch (err) { setError(apiError(err)); }
  };

  const weekAgo = Date.now() - 7 * 86400000;
  const recent = (data?.items || []).filter((n) => new Date(n.created_at).getTime() >= weekAgo);
  const older = (data?.items || []).filter((n) => new Date(n.created_at).getTime() < weekAgo);

  const item = (n) => (
    <div key={n.id} role="button" tabIndex={0} onClick={() => open(n)} onKeyDown={(e) => { if (e.key === 'Enter') open(n); }}
      style={{
        display: 'flex', gap: 12, padding: '14px 12px', borderRadius: 8, cursor: 'pointer', position: 'relative',
        background: n.read ? 'transparent' : 'var(--tk-sel)', marginBottom: 4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = M.hover; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = n.read ? 'transparent' : 'var(--tk-sel)'; }}>
      <Avatar id={n.actor_id || 0} name={n.actor_name || '?'} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, color: M.text, flex: 1 }}>
            <strong style={{ fontWeight: 600 }}>{n.actor_name || 'Quelqu’un'}</strong>{' '}
            <span style={{ color: M.sub }}>{VERB[n.kind] || n.kind}</span>
          </span>
          <span style={{ fontSize: 12, color: M.sub, whiteSpace: 'nowrap' }}>{ago(n.created_at)}</span>
          {!n.read && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0073EA', flexShrink: 0 }} />}
        </div>
        {n.body && (n.kind === 'mention' || n.kind === 'comment') && (
          <div style={{
            fontSize: 14, color: M.text, marginTop: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>{n.body}</div>
        )}
        {(n.kind === 'assigned' || n.kind === 'unblocked') && n.step_name && (
          <div style={{ fontSize: 14, color: M.text, marginTop: 6 }}>Étape « {n.step_name} »</div>
        )}
        <div style={{ fontSize: 13, color: 'var(--tk-link)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ▦ {n.task_title || 'Tâche supprimée'}{n.task_id ? <span style={{ color: M.sub }}> · #{n.task_id}</span> : ''}
        </div>
        <button type="button" onClick={(e) => toggleRead(n, e)}
          style={{ background: 'none', border: 'none', color: M.sub, fontSize: 12, cursor: 'pointer', padding: '4px 0 0', fontFamily: 'inherit' }}>
          {n.read ? 'Marquer comme non lu' : 'Marquer comme lu'}
        </button>
      </div>
    </div>
  );

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 2900, background: 'rgba(15,23,42,0.25)' }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '100%', background: 'var(--tk-surface)',
        boxShadow: '-10px 0 30px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', fontFamily: M.font,
      }}>
        <div style={{ padding: '22px 24px 0', display: 'flex', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 500, color: M.text, flex: 1 }}>Notifications</h2>
          <button type="button" onClick={readAll} style={{ background: 'none', border: 'none', color: 'var(--tk-link)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, marginRight: 12 }}>
            Tout marquer comme lu
          </button>
          <button type="button" onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', fontSize: 26, color: M.sub, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: 'flex', gap: 4, padding: '14px 24px 0', borderBottom: `1px solid ${M.border}` }}>
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} style={{
              background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 15, padding: '8px 14px', marginBottom: -1,
              color: M.text, borderBottom: `2px solid ${tab === t.key ? '#0073EA' : 'transparent'}`,
            }}>{t.label}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Rechercher par personne, tâche, texte…"
            style={{ flex: 1, border: `1px solid ${M.border}`, borderRadius: 6, padding: '8px 10px', fontFamily: 'inherit', fontSize: 14 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: M.text, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Non lu uniquement
          </label>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 24px' }}>
          {error && <div style={{ margin: 12, color: 'var(--tk-danger)', fontSize: 13 }}>{error}</div>}
          {!data && !error && <div style={{ padding: 12, color: M.sub }}>Chargement…</div>}
          {data && !data.items.length && <div style={{ padding: 24, color: M.sub, textAlign: 'center' }}>Aucune notification.</div>}
          {recent.length > 0 && <h3 style={{ fontSize: 16, fontWeight: 600, margin: '8px 12px' }}>7 derniers jours</h3>}
          {recent.map(item)}
          {older.length > 0 && <h3 style={{ fontSize: 16, fontWeight: 600, margin: '16px 12px 8px' }}>Notifications plus anciennes</h3>}
          {older.map(item)}
        </div>
      </div>
    </div>
  );
}
