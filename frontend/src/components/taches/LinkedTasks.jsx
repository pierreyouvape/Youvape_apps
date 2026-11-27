import { useState } from 'react';
import { tachesApi, apiError, TASK_STATUS, btn, inputStyle } from './tachesShared';

const KINDS = [
  { key: 'relates', label: 'Liée à' },
  { key: 'blocks', label: 'Bloque' },
  { key: 'blocked_by', label: 'Bloquée par' },
];
const label = { fontSize: 12, fontWeight: 800, color: 'var(--tk-muted)', textTransform: 'uppercase' };

/** Tâches liées (comme les « Linked items » de GitLab) : liée à, bloque, bloquée par. */
export default function LinkedTasks({ task, onTask, onError, onOpenTask }) {
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('relates');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const links = task.links || [];

  const add = async (otherId) => {
    try {
      onTask(await tachesApi.addLink(task.id, otherId, kind));
      setQuery('');
      setHits([]);
      setAdding(false);
    } catch (e) { onError(apiError(e)); }
  };
  const remove = async (l) => {
    if (!window.confirm(`Retirer le lien avec la tâche #${l.task.id} ?`)) return;
    try { onTask(await tachesApi.deleteLink(task.id, l.id)); } catch (e) { onError(apiError(e)); }
  };
  // Recherche par titre ; un numéro (#42 ou 42) se lie directement.
  const search = async (q) => {
    setQuery(q);
    const t = q.trim();
    if (t.length < 2 || /^#?\d+$/.test(t)) { setHits([]); return; }
    try {
      const res = await tachesApi.search(t);
      const seen = new Set();
      setHits(res.filter((h) => h.task_id !== task.id && !seen.has(h.task_id) && seen.add(h.task_id)).slice(0, 8));
    } catch { setHits([]); }
  };
  const submit = () => {
    const t = query.trim();
    if (/^#?\d+$/.test(t)) add(Number(t.replace('#', '')));
    else if (hits[0]) add(hits[0].task_id);
  };

  return (
    <div style={{ padding: '0 22px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={label}>Tâches liées ({links.length})</span>
        <span style={{ flex: 1 }} />
        {!adding && <button type="button" style={{ ...btn(), padding: '4px 10px', fontSize: 12 }} onClick={() => setAdding(true)}>+ Lier une tâche</button>}
      </div>

      {adding && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, position: 'relative' }}>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, width: 140, padding: '6px 8px' }}>
            {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
          </select>
          <div style={{ flex: 1, position: 'relative' }}>
            <input autoFocus value={query} onChange={(e) => search(e.target.value)} placeholder="#42 ou un mot du titre…"
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setAdding(false); }}
              style={{ ...inputStyle, padding: '6px 8px' }} />
            {hits.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, marginTop: 4, background: 'var(--tk-surface)',
                border: '1px solid var(--tk-border)', borderRadius: 8, boxShadow: '0 10px 30px rgba(15,23,42,0.18)', maxHeight: 260, overflowY: 'auto',
              }}>
                {hits.map((h) => (
                  <button key={h.task_id} type="button" onClick={() => add(h.task_id)} style={{
                    display: 'flex', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer',
                    padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', color: 'var(--tk-text)',
                  }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--tk-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}>
                    <span style={{ color: 'var(--tk-sub)', flexShrink: 0 }}>#{h.task_id}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button type="button" style={btn(true)} onClick={submit} disabled={!query.trim()}>Lier</button>
          <button type="button" style={btn()} onClick={() => { setAdding(false); setQuery(''); setHits([]); }}>Annuler</button>
        </div>
      )}

      {links.length > 0 && (
        <div style={{ border: '1px solid var(--tk-line)', borderRadius: 8, overflow: 'hidden' }}>
          {KINDS.map((k) => links.filter((l) => l.kind === k.key).map((l) => {
            const st = TASK_STATUS[l.task.status];
            return (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderBottom: '1px solid var(--tk-line)', fontSize: 14 }}>
                <span style={{ width: 92, flexShrink: 0, fontSize: 12, fontWeight: 700, color: k.key === 'relates' ? 'var(--tk-sub)' : 'var(--tk-danger)' }}>{k.label}</span>
                <a role="button" tabIndex={0} onClick={() => onOpenTask?.(l.task.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenTask?.(l.task.id); }}
                  title="Ouvrir la tâche"
                  style={{ flex: 1, minWidth: 0, cursor: 'pointer', color: 'var(--tk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: l.task.archived_at ? 'line-through' : 'none' }}>
                  <span style={{ color: 'var(--tk-link)', fontWeight: 600 }}>#{l.task.id}</span> {l.task.title}
                </a>
                <span style={{ fontSize: 12, color: 'var(--tk-sub)', flexShrink: 0 }}>{l.task.board}</span>
                {st && <span style={{ background: st.bg, color: '#fff', fontSize: 12, borderRadius: 4, padding: '2px 8px', flexShrink: 0 }}>{st.label}</span>}
                <button type="button" title="Retirer le lien" onClick={() => remove(l)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--tk-muted)', fontSize: 16, padding: '0 4px' }}>×</button>
              </div>
            );
          }))}
        </div>
      )}
    </div>
  );
}
