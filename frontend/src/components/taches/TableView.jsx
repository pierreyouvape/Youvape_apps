import { Fragment, useMemo, useState } from 'react';
import {
  tachesApi, apiError, ago, todayStr, labelChip, inputStyle, btn, M, mTable, mTh, mTd, mCell, ellipsis,
} from './tachesShared';
import {
  ProgressBar, PriorityPill, TaskStatusPill, Avatar, PeoplePicker, DotsMenu, DateRange, InlineText,
} from './tachesUi';
import StepsTable from './StepsTable';

const th = mTh;
const td = mTd;
const COLLAPSE_KEY = 'yv.taches.collapsed';
const PALETTE = ['#579BFC', '#00C875', '#FDAB3D', '#A25DDC', '#E2445C', '#037F4C', '#784BD1', '#FF158A', '#C4C4C4'];
const shortUrl = (u) => (u || '').replace(/^https?:\/\/(www\.)?/, '');

const loadCollapsed = () => {
  try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]')); } catch { return new Set(); }
};

/**
 * Vue Tableau : les tâches par groupe (comme Monday), dépliables en étapes.
 * Cases à cocher pour archiver, déplacer ou supprimer plusieurs tâches d'un coup.
 */
export default function TableView({
  tasks, loading, board, boards, members, canWrite, focusUserId,
  onOpen, onTaskChange, onError, onReload, onBoardsChange,
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [selected, setSelected] = useState(() => new Set());
  const [moveTo, setMoveTo] = useState('');
  const [quick, setQuick] = useState({});
  const today = todayStr();

  // Sections : les groupes du tableau (ou de tous les tableaux), puis « Sans groupe ».
  const sections = useMemo(() => {
    const list = board ? [board] : boards;
    const out = list.flatMap((b) => b.groups.map((g) => ({
      ...g, boardName: board ? null : b.name, tasks: tasks.filter((t) => t.group_id === g.id),
    })));
    const orphans = tasks.filter((t) => !out.some((g) => g.id === t.group_id));
    if (orphans.length) out.push({ id: 'none', name: 'Sans groupe', color: '#C4C4C4', tasks: orphans });
    return out;
  }, [tasks, board, boards]);

  const allGroups = boards.flatMap((b) => b.groups.map((g) => ({ ...g, label: boards.length > 1 ? `${b.name} › ${g.name}` : g.name })));
  const toggleSet = (setter, key) => setter((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const toggleCollapse = (gid) => setCollapsed((s) => {
    const n = new Set(s);
    if (n.has(gid)) n.delete(gid); else n.add(gid);
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...n]));
    return n;
  });
  // Un groupe « terminé » est replié tant qu'on ne l'a jamais ouvert.
  const isCollapsed = (g) => (collapsed.has(g.id) ? true : collapsed.has(`open:${g.id}`) ? false : /termin/i.test(g.name));
  const flip = (g) => {
    if (/termin/i.test(g.name) && !collapsed.has(g.id)) toggleCollapse(`open:${g.id}`);
    else toggleCollapse(g.id);
  };

  const save = async (t, body) => {
    try { onTaskChange(await tachesApi.updateTask(t.id, body)); } catch (e) { onError(apiError(e)); }
  };
  const bulk = async (action, extra = {}) => {
    const ids = [...selected];
    if (action === 'delete' && !window.confirm(`Supprimer définitivement ${ids.length} tâche(s), leurs étapes et commentaires ?`)) return;
    try {
      await tachesApi.bulk({ ids, action, ...extra });
      setSelected(new Set());
      onReload();
    } catch (e) { onError(apiError(e)); }
  };
  const one = async (t, action, extra = {}) => {
    if (action === 'delete' && !window.confirm(`Supprimer définitivement « ${t.title} », ses étapes et ses commentaires ?`)) return;
    try {
      await tachesApi.bulk({ ids: [t.id], action, ...extra });
      onReload();
    } catch (e) { onError(apiError(e)); }
  };
  const groupAction = async (fn) => {
    try { onBoardsChange(await fn()); } catch (e) { onError(apiError(e)); }
  };
  const quickAdd = async (g) => {
    const title = (quick[g.id] || '').trim();
    if (!title) return;
    try {
      await tachesApi.createTask({ title, board_id: g.board_id, group_id: g.id });
      setQuick((s) => ({ ...s, [g.id]: '' }));
      onReload();
    } catch (e) { onError(apiError(e)); }
  };

  if (loading) return <div style={{ color: '#9CA3AF', padding: 20 }}>Chargement…</div>;

  return (
    <div>
      {selected.size > 0 && (
        <div style={{
          position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          background: '#1E3A8A', color: '#fff', borderRadius: 10, padding: '8px 12px', marginBottom: 10,
        }}>
          <strong>{selected.size} sélectionnée{selected.size > 1 ? 's' : ''}</strong>
          <button type="button" style={btn()} onClick={() => bulk('archive')}>Archiver</button>
          <button type="button" style={btn()} onClick={() => bulk('unarchive')}>Désarchiver</button>
          <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={{ ...inputStyle, width: 230, padding: '6px 8px' }}>
            <option value="">Déplacer vers…</option>
            {allGroups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
          </select>
          <button type="button" style={btn()} disabled={!moveTo} onClick={() => { bulk('move', { group_id: Number(moveTo) }); setMoveTo(''); }}>Déplacer</button>
          {canWrite && <button type="button" style={{ ...btn(), color: '#B91C1C' }} onClick={() => bulk('delete')}>Supprimer</button>}
          <span style={{ flex: 1 }} />
          <button type="button" style={{ ...btn(), background: 'transparent', color: '#fff', borderColor: '#93C5FD' }} onClick={() => setSelected(new Set())}>Annuler</button>
        </div>
      )}

      {sections.map((g) => {
        const shut = isCollapsed(g);
        const ids = g.tasks.map((t) => t.id);
        const allChecked = ids.length > 0 && ids.every((i) => selected.has(i));
        const done = g.tasks.filter((t) => t.status === 'fait').length;
        return (
          <div key={g.id} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button type="button" onClick={() => flip(g)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: g.color, fontSize: 14 }}>
                {shut ? '▶' : '▼'}
              </button>
              {g.boardName && <span style={{ fontSize: 13, color: '#9CA3AF', fontWeight: 700 }}>{g.boardName} ›</span>}
              {canWrite && g.id !== 'none' ? (
                <InlineText value={g.name} onSave={(name) => groupAction(() => tachesApi.updateGroup(g.id, { name }))}
                  style={{ fontSize: 18, fontWeight: 500, color: g.color }} />
              ) : (
                <span style={{ fontSize: 18, fontWeight: 500, color: g.color }}>{g.name}</span>
              )}
              <span style={{ fontSize: 14, color: M.sub }}>{g.tasks.length} tâche{g.tasks.length > 1 ? 's' : ''}{done ? ` · ${done} terminée${done > 1 ? 's' : ''}` : ''}</span>
              {canWrite && g.id !== 'none' && (
                <DotsMenu items={[
                  { label: '↑ Monter le groupe', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { direction: 'up' })) },
                  { label: '↓ Descendre le groupe', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { direction: 'down' })) },
                  { label: '🎨 Changer la couleur', onClick: () => groupAction(() => tachesApi.updateGroup(g.id, { color: PALETTE[(PALETTE.indexOf(g.color) + 1) % PALETTE.length] })) },
                  { label: '🗑 Supprimer le groupe', danger: true, onClick: () => {
                    if (window.confirm(`Supprimer le groupe « ${g.name} » ? Ses tâches passent dans un autre groupe du tableau.`)) {
                      groupAction(() => tachesApi.deleteGroup(g.id)).then(onReload);
                    }
                  } },
                ]} />
              )}
            </div>

            {!shut && (
              <div style={{ background: '#fff', borderLeft: `6px solid ${g.color}`, borderRadius: '6px 0 0 6px', overflowX: 'auto', fontFamily: M.font }}>
                <table style={{ ...mTable, minWidth: 1560 }}>
                  <colgroup>
                    <col style={{ width: 34 }} />
                    <col style={{ width: 26 }} />
                    <col style={{ width: 380 }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 170 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 36 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={th}>
                        <input type="checkbox" checked={allChecked} title="Tout sélectionner"
                          onChange={() => setSelected((s) => {
                            const n = new Set(s);
                            ids.forEach((i) => (allChecked ? n.delete(i) : n.add(i)));
                            return n;
                          })} />
                      </th>
                      <th style={th} />
                      <th style={{ ...th, textAlign: 'left' }}>Tâche</th>
                      <th style={th}>Personne</th>
                      <th style={th}>Lien produit</th>
                      <th style={th}>Sous-éléments</th>
                      <th style={th}>Étiquettes</th>
                      <th style={th}>Échéances</th>
                      <th style={th}>Mise à jour</th>
                      <th style={th}>Priorité</th>
                      <th style={th}>Statut</th>
                      <th style={{ ...th, borderRight: 'none' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {g.tasks.map((t) => {
                      const open = expanded.has(t.id);
                      const late = t.due_date && t.status !== 'fait' && t.due_date < today;
                      return (
                        <Fragment key={t.id}>
                          <tr style={{ background: selected.has(t.id) ? '#CCE5FF' : open ? M.hover : '#fff', opacity: t.archived_at ? 0.6 : 1 }}>
                            <td style={{ ...td, padding: 0 }}><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSet(setSelected, t.id)} /></td>
                            <td style={{ ...td, padding: 0 }}>
                              {t.steps.length > 0 && (
                                <button type="button" onClick={() => toggleSet(setExpanded, t.id)} title={open ? 'Replier' : 'Voir les étapes'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 11, width: '100%', height: 36 }}>{open ? '▼' : '▶'}</button>
                              )}
                            </td>
                            <td style={{ ...td, textAlign: 'left' }} title={t.title}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button type="button" onClick={() => onOpen(t.id)} style={{
                                  ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 14, color: M.text, textAlign: 'left', flex: '0 1 auto', minWidth: 0,
                                }}>{t.title}</button>
                                {t.steps.length > 0 && (
                                  <span style={{ fontSize: 12, color: M.sub, background: '#E6E9EF', borderRadius: 4, padding: '0 5px', flexShrink: 0 }}>{t.steps.length}</span>
                                )}
                                {t.archived_at && <span style={{ fontSize: 11, color: '#B45309', fontWeight: 700, flexShrink: 0 }}>ARCHIVÉE</span>}
                                <span style={{ flex: 1 }} />
                                <span title="Commentaires" style={{ fontSize: 13, color: t.comment_count ? '#0073EA' : '#C3C6D4', flexShrink: 0 }}>
                                  💬{t.comment_count ? ` ${t.comment_count}` : ''}
                                </span>
                              </span>
                            </td>
                            <td style={td}><PeoplePicker title="Personne(s) de la tâche" value={t.people} members={members} onChange={(people) => save(t, { people })} /></td>
                            <td style={{ ...td, textAlign: 'left' }}>
                              {t.link_url && <a href={t.link_url} target="_blank" rel="noreferrer" style={{ ...ellipsis, fontSize: 13, color: '#0073EA' }} title={t.link_url}>{shortUrl(t.link_url)}</a>}
                            </td>
                            <td style={td}>{t.steps.length > 0 ? <ProgressBar counts={t.counts} width={110} /> : ''}</td>
                            <td style={td}>
                              <span style={{ display: 'flex', gap: 3, justifyContent: 'center', overflow: 'hidden' }} title={t.labels.join(', ')}>
                                {t.labels.map((l) => <span key={l} style={{ ...labelChip, background: '#E6E9EF', color: M.text, fontWeight: 400, borderRadius: 3 }}>{l}</span>)}
                              </span>
                            </td>
                            <td style={td}><DateRange start={t.start_date} end={t.due_date} late={late} onChange={(b) => save(t, b)} /></td>
                            <td style={{ ...td, fontSize: 13, color: M.sub }}>
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                {t.updated_by && <Avatar id={t.updated_by} name={t.updated_by_name} size={22} />}
                                {ago(t.updated_at)}
                              </span>
                            </td>
                            <td style={mCell}><PriorityPill cell priority={t.priority} onChange={(priority) => save(t, { priority })} /></td>
                            <td style={mCell}>
                              <TaskStatusPill cell status={t.status} onChange={t.steps.length ? undefined : (manual_status) => save(t, { manual_status })} />
                            </td>
                            <td style={{ ...td, padding: 0, borderRight: 'none' }}>
                              <DotsMenu items={[
                                { label: 'Ouvrir', onClick: () => onOpen(t.id) },
                                { label: t.archived_at ? 'Désarchiver' : 'Archiver', onClick: () => one(t, t.archived_at ? 'unarchive' : 'archive') },
                                ...allGroups.filter((x) => x.id !== t.group_id).map((x) => ({ label: `Déplacer → ${x.label}`, onClick: () => one(t, 'move', { group_id: x.id }) })),
                                { label: 'Supprimer', danger: true, hidden: !canWrite, onClick: () => one(t, 'delete') },
                              ]} />
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td colSpan={2} style={{ borderBottom: `1px solid ${M.grid}`, background: M.hover }} />
                              <td colSpan={10} style={{ padding: '8px 12px 14px 0', borderBottom: `1px solid ${M.grid}`, background: M.hover }}>
                                <StepsTable task={t} members={members} onChange={onTaskChange} onError={onError} focusUserId={focusUserId} color={g.color} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {g.id !== 'none' && (
                      <tr>
                        <td style={td} />
                        <td style={td} />
                        <td colSpan={10} style={{ ...td, textAlign: 'left' }}>
                          <input value={quick[g.id] || ''} onChange={(e) => setQuick((s) => ({ ...s, [g.id]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === 'Enter') quickAdd(g); }}
                            placeholder="+ Ajouter tâche"
                            style={{ border: 'none', outline: 'none', width: '100%', fontSize: 14, fontFamily: 'inherit', color: M.text }} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {canWrite && board && (
        <button type="button" style={btn()} onClick={() => {
          const name = window.prompt('Nom du nouveau groupe ?');
          if (name) groupAction(() => tachesApi.createGroup(board.id, { name }));
        }}>+ Ajouter un groupe</button>
      )}
      {!tasks.length && <div style={{ color: '#9CA3AF', padding: 10 }}>Aucune tâche ne correspond.</div>}
    </div>
  );
}
