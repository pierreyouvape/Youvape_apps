import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { tachesApi, apiError, ago, priorityRank, TACHES_COLOR } from './tachesShared';
import { ProgressBar, PriorityPill, TaskStatusPill, Avatar } from './tachesUi';
import { btn, inputStyle } from './tachesShared';
import StepsTable from './StepsTable';

const th = {
  fontSize: 13, fontWeight: 700, color: '#4B5563', padding: '10px 8px', textAlign: 'center',
  borderBottom: '1px solid #E5E7EB', background: '#fff', position: 'sticky', top: 0, zIndex: 1, whiteSpace: 'nowrap',
};
const td = { padding: '6px 8px', borderBottom: '1px solid #EEF0F3', textAlign: 'center', verticalAlign: 'middle', fontSize: 14 };
const chip = (active, color = TACHES_COLOR) => ({
  border: `1px solid ${active ? color : '#D1D5DB'}`, background: active ? color : '#fff', color: active ? '#fff' : '#374151',
  borderRadius: 999, padding: '5px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
});

const shortUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '');

/**
 * Vue générale : toutes les tâches, dépliables en étapes (tableau principal de
 * Monday). Le filtre « Personne » remplace les onglets Maxime / Pierre / … :
 * tâches où elle est responsable d'au moins une étape.
 */
export default function BoardTab({ members, labels, reloadKey, onOpen, onNew }) {
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState('');
  const [person, setPerson] = useState(null);
  const [openOnly, setOpenOnly] = useState(true);
  const [label, setLabel] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('recent');
  const [expanded, setExpanded] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.board({ done: showDone ? 1 : 0, archived: archived ? 1 : 0 }));
      setError(null);
    } catch (e) {
      setError(apiError(e));
    }
  }, [showDone, archived]);

  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(load, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  const replace = (t) => setTasks((list) => list.map((x) => (x.id === t.id ? t : x)));
  const toggle = (id) => setExpanded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (tasks || []).filter((t) => {
      if (label && t.label !== label) return false;
      if (q && !`${t.title} ${t.link_url || ''} ${t.steps.map((s) => s.name).join(' ')}`.toLowerCase().includes(q)) return false;
      if (person) {
        const mine = t.steps.filter((s) => s.owners.includes(person));
        if (!mine.length) return false;
        if (openOnly && !mine.some((s) => s.status === 'a_faire' || s.status === 'en_cours')) return false;
      }
      return true;
    });
    if (sort === 'priority') {
      list = [...list].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || b.updated_at.localeCompare(a.updated_at));
    } else if (sort === 'recent') {
      list = [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    }
    return list;
  }, [tasks, search, person, openOnly, label, sort]);

  const memberName = (id) => members.find((m) => m.id === id)?.name || '?';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={btn(true)} onClick={onNew}>+ Nouvelle tâche</button>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…"
          style={{ ...inputStyle, width: 220 }} />
        <select value={label} onChange={(e) => setLabel(e.target.value)} style={{ ...inputStyle, width: 170 }}>
          <option value="">Toutes les étiquettes</option>
          {labels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} style={{ ...inputStyle, width: 190 }}>
          <option value="recent">Dernière mise à jour</option>
          <option value="priority">Priorité</option>
          <option value="manual">Ordre de création</option>
        </select>
        <label style={{ fontSize: 13, color: '#4B5563', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Terminées
        </label>
        <label style={{ fontSize: 13, color: '#4B5563', display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archivées
        </label>
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button type="button" style={chip(!person)} onClick={() => setPerson(null)}>Tout le monde</button>
        {members.map((m) => (
          <button key={m.id} type="button" style={chip(person === m.id)} onClick={() => setPerson(m.id)}>{m.name}</button>
        ))}
        {person && (
          <label style={{ fontSize: 13, color: '#4B5563', display: 'flex', gap: 6, alignItems: 'center', marginLeft: 8 }}>
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Seulement ce que {memberName(person)} a à faire maintenant
          </label>
        )}
      </div>

      {error && <div style={{ padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderLeft: `5px solid ${TACHES_COLOR}`, borderRadius: 10, overflow: 'auto', maxHeight: 'calc(100vh - 290px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: 30 }} />
              <th style={{ ...th, textAlign: 'left' }}>
                Tâche <span style={{ color: '#9CA3AF', fontWeight: 500 }}>{tasks ? `${visible.length} / ${tasks.length}` : ''}</span>
              </th>
              <th style={{ ...th, width: 230 }}>Lien</th>
              <th style={{ ...th, width: 140 }}>Étapes</th>
              <th style={{ ...th, width: 140 }}>Étiquette</th>
              <th style={{ ...th, width: 160 }}>Dernière mise à jour</th>
              <th style={{ ...th, width: 120 }}>Priorité</th>
              <th style={{ ...th, width: 110 }}>Statut</th>
            </tr>
          </thead>
          <tbody>
            {tasks === null && <tr><td colSpan={8} style={{ ...td, color: '#9CA3AF', padding: 30 }}>Chargement…</td></tr>}
            {tasks && !visible.length && <tr><td colSpan={8} style={{ ...td, color: '#9CA3AF', padding: 30 }}>Aucune tâche.</td></tr>}
            {visible.map((t) => {
              const open = expanded.has(t.id);
              return (
                <Fragment key={t.id}>
                  <tr style={{ background: open ? '#F8FAFF' : '#fff' }}>
                    <td style={td}>
                      <button type="button" onClick={() => toggle(t.id)} title={open ? 'Replier' : 'Voir les étapes'}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6B7280', fontSize: 13 }}>
                        {open ? '▼' : '▶'}
                      </button>
                    </td>
                    <td style={{ ...td, textAlign: 'left' }}>
                      <button type="button" onClick={() => onOpen(t.id)} style={{
                        background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 14, fontWeight: 700, color: '#1F2937', textAlign: 'left',
                      }}>{t.title}</button>
                      {t.steps.length > 0 && (
                        <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#6B7280', background: '#F3F4F6', borderRadius: 4, padding: '1px 5px' }}>
                          {t.steps.length}
                        </span>
                      )}
                      {t.comment_count > 0 && (
                        <span title="Commentaires" style={{ marginLeft: 6, fontSize: 12, color: '#2563EB' }}>💬 {t.comment_count}</span>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 230, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.link_url && <a href={t.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }} title={t.link_url}>{shortUrl(t.link_url)}</a>}
                    </td>
                    <td style={td}><ProgressBar counts={t.counts} /></td>
                    <td style={td}>
                      {t.label && <span style={{ background: '#E0EAFF', color: '#1E40AF', borderRadius: 4, padding: '3px 8px', fontSize: 13, fontWeight: 600 }}>{t.label}</span>}
                    </td>
                    <td style={{ ...td, fontSize: 13, color: '#4B5563' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {t.updated_by && <Avatar id={t.updated_by} name={t.updated_by_name} size={24} />}
                        {ago(t.updated_at)}
                      </span>
                    </td>
                    <td style={td}>
                      <PriorityPill priority={t.priority} onChange={async (priority) => {
                        try { replace(await tachesApi.updateTask(t.id, { priority })); } catch (e) { setError(apiError(e)); }
                      }} />
                    </td>
                    <td style={td}><TaskStatusPill status={t.status} /></td>
                  </tr>
                  {open && (
                    <tr>
                      <td style={{ borderBottom: '1px solid #E5E7EB' }} />
                      <td colSpan={7} style={{ padding: '6px 12px 14px 0', borderBottom: '1px solid #E5E7EB', background: '#F8FAFF' }}>
                        <div style={{ border: '1px solid #DBEAFE', borderRadius: 8, background: '#fff' }}>
                          <StepsTable task={t} members={members} onChange={replace} onError={setError} focusUserId={person} />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
