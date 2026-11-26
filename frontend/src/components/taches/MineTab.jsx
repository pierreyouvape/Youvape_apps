import { Fragment, useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import {
  tachesApi, apiError, priorityRank, todayStr, formatDay, formatDateTime, ago, M, mTable, mTh, mTd, mCell, ellipsis, inputStyle,
  PRIORITY, PRIORITY_ORDER, STEP_STATUS, STEP_STATUS_ORDER, TASK_STATUS,
} from './tachesShared';
import { Avatar, PriorityPill, AvatarStack, StepStatusPill, TaskStatusPill, DateRange, ColGroup, ColResizer, SortMark } from './tachesUi';
import { useColumnWidths, useSort, sortRows } from './tachesColumns';
import StepsTable from './StepsTable';
import CommentsPopup from './CommentsThread';

const GROUPS = [
  { key: 'now', title: 'À traiter maintenant', color: '#579BFC' },
  { key: 'long', title: 'Tâches de fond', color: '#A25DDC' },
  { key: 'later', title: 'Bientôt pour moi — attend l\'étape d\'avant', color: '#DF2F4A' },
];

/**
 * Mes tâches, façon « Mon travail » de Monday : une ligne par chose à faire
 * (mon étape, ou une tâche sans étape dont je suis la personne), tous tableaux
 * confondus. ▶ déplie
 * toute la chaîne, les étapes passées en grisé.
 */
export default function MineTab({ members, reloadKey, onOpen, onError }) {
  const cols = useColumnWidths('mine', [32, 420, 70, 300, 120, 190, 90, 150, 150, 120]);
  const { user } = useContext(AuthContext);
  const me = user?.id;
  const [tasks, setTasks] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [closed, setClosed] = useState(() => new Set());
  const { sort, toggle } = useSort('mine');
  const [q, setQ] = useState('');
  const [fLabel, setFLabel] = useState('');
  const [fPriority, setFPriority] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [commentsId, setCommentsId] = useState(null);

  const load = useCallback(async () => {
    try {
      setTasks(await tachesApi.mine());
    } catch (e) {
      onError(apiError(e));
    }
  }, [onError]);
  useEffect(() => { load(); }, [load, reloadKey]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(load, 60000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(timer); };
  }, [load]);

  const replace = (t) => setTasks((list) => list.map((x) => (x.id === t.id ? t : x)));
  const act = async (fn) => {
    try {
      replace(await fn());
      load(); // une étape faite peut sortir de la liste, une autre y entrer
    } catch (e) {
      onError(apiError(e));
    }
  };
  const flip = (setter, key) => setter((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  if (tasks === null) return <div style={{ color: M.sub, padding: 20 }}>Chargement…</div>;

  const today = todayStr();
  const rows = tasks
    .map((t) => ({ task: t, step: t.steps.find((s) => s.status !== 'fait' && s.owners.includes(me)) || null }))
    .filter((r) => r.step || (!r.task.steps.length && r.task.people.includes(me) && r.task.status !== 'fait'));
  const stateOf = (r) => (r.step ? r.step.status : r.task.status);
  const due = (r) => (r.step ? r.step.due_date : r.task.due_date);
  const allLabels = [...new Set(rows.flatMap((r) => r.task.labels))].sort((a, b) => a.localeCompare(b, 'fr'));
  const fold = (x) => String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtered = rows.filter((r) => {
    if (fLabel && !r.task.labels.includes(fLabel)) return false;
    if (fPriority && (r.task.priority || 'none') !== fPriority) return false;
    if (fStatus && stateOf(r) !== fStatus) return false;
    if (q.trim() && !fold(`${r.task.title} ${r.step?.name || ''} ${r.task.labels.join(' ')}`).includes(fold(q.trim()))) return false;
    return true;
  });
  // Ordre par défaut : priorité, échéance, dernière mise à jour ; un clic sur un en-tête le remplace.
  const cmp = (a, b) => priorityRank(a.task.priority) - priorityRank(b.task.priority)
    || (due(a) || '9999').localeCompare(due(b) || '9999') || b.task.updated_at.localeCompare(a.task.updated_at);
  const statusRank = (r) => (r.step ? STEP_STATUS_ORDER.indexOf(r.step.status) : ['a_faire', 'en_cours', 'bloque', 'longue', 'fait'].indexOf(r.task.status));
  const accessors = {
    task: (r) => r.task.title,
    id: (r) => r.task.id,
    step: (r) => r.step?.name || '',
    created: (r) => r.task.created_at,
    handed: (r) => handOver(r).at || '',
    owner: (r) => (r.step ? r.step.owners : r.task.people).map((id) => members.find((m) => m.id === id)?.name || '').join(', '),
    status: statusRank,
    due: (r) => due(r) || '',
    priority: (r) => (r.task.priority ? priorityRank(r.task.priority) : ''),
  };
  /**
   * Dernière mise à jour = quand le travail m'a été passé : l'étape d'avant
   * terminée (date et auteur). Première étape, ou tâche sans étape : dernière
   * modification de la tâche.
   */
  function handOver({ task, step }) {
    if (step) {
      const i = task.steps.findIndex((x) => x.id === step.id);
      const prev = i > 0 ? task.steps[i - 1] : null;
      if (prev?.status === 'fait' && prev.done_at) {
        return { at: prev.done_at, by: prev.done_by, name: prev.done_by_name, what: `« ${prev.name} » fait` };
      }
    }
    return { at: task.updated_at, by: task.updated_by, name: task.updated_by_name, what: 'Tâche modifiée' };
  }
  const order = (list) => sortRows([...list].sort(cmp), sort, accessors);
  const bucket = {
    now: order(filtered.filter((r) => !['bloque', 'longue'].includes(stateOf(r)))),
    long: order(filtered.filter((r) => stateOf(r) === 'longue')),
    later: order(filtered.filter((r) => stateOf(r) === 'bloque')),
  };
  const filtering = Boolean(q || fLabel || fPriority || fStatus);
  const sel = { ...inputStyle, width: 180, padding: '6px 8px', fontSize: 13 };
  const sortTh = (base) => ({ ...base, cursor: 'pointer', userSelect: 'none' });

  return (
    <div style={{ fontFamily: M.font, color: M.text }}>
      {commentsId && <CommentsPopup taskId={commentsId} members={members} onClose={() => setCommentsId(null)} onChanged={() => load()} onOpenTask={onOpen} />}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Filtrer (tâche, étape, étiquette)" style={{ ...sel, width: 260 }} />
        <select value={fLabel} onChange={(e) => setFLabel(e.target.value)} style={sel}>
          <option value="">Toutes les étiquettes</option>
          {allLabels.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} style={sel}>
          <option value="">Toutes les priorités</option>
          {PRIORITY_ORDER.map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
          <option value="none">Sans priorité</option>
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={sel}>
          <option value="">Tous les statuts</option>
          {STEP_STATUS_ORDER.filter((k) => k !== 'fait').map((k) => <option key={k} value={k}>{STEP_STATUS[k].label}</option>)}
          <option value="longue">{TASK_STATUS.longue.label}</option>
        </select>
        {filtering && (
          <button type="button" onClick={() => { setQ(''); setFLabel(''); setFPriority(''); setFStatus(''); }}
            style={{ background: 'none', border: 'none', color: '#0073EA', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Effacer les filtres</button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: M.sub }}>
          {filtered.length} / {rows.length} élément{rows.length > 1 ? 's' : ''}{sort ? ' · clic sur l\'en-tête trié pour changer l\'ordre' : ' · cliquez un en-tête pour trier'}
        </span>
      </div>
      {GROUPS.map((g) => {
        const list = bucket[g.key];
        if (!list.length && g.key !== 'now') return null;
        const shut = closed.has(g.key);
        return (
          <div key={g.key} style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <button type="button" onClick={() => flip(setClosed, g.key)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: g.color, fontSize: 13, padding: 0 }}>{shut ? '▶' : '▼'}</button>
              <span style={{ fontSize: 18, fontWeight: 500, color: g.color }}>{g.title}</span>
              <span style={{ fontSize: 14, color: M.sub }}>{list.length} élément{list.length > 1 ? 's' : ''}</span>
            </div>
            {!shut && (
              <div style={{ borderLeft: `6px solid ${g.color}`, borderRadius: '6px 0 0 6px', background: '#fff', overflowX: 'auto' }}>
                <table style={{ ...mTable, width: cols.total }}>
                  <ColGroup widths={cols.widths} />
                  <thead>
                    <tr>
                      <th style={mTh}><ColResizer index={0} cols={cols} /></th>
                      <th style={sortTh({ ...mTh, textAlign: 'left' })} onClick={() => toggle('task')} title="Trier">Tâche<SortMark sort={sort} col="task" /><ColResizer index={1} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('id')} title="Trier">ID<SortMark sort={sort} col="id" /><ColResizer index={2} cols={cols} /></th>
                      <th style={sortTh({ ...mTh, textAlign: 'left' })} onClick={() => toggle('step')} title="Trier">Mon étape<SortMark sort={sort} col="step" /><ColResizer index={3} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('created')} title="Trier">Créée le<SortMark sort={sort} col="created" /><ColResizer index={4} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('handed')} title="Trier">Dernière mise à jour<SortMark sort={sort} col="handed" /><ColResizer index={5} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('owner')} title="Trier">Owner<SortMark sort={sort} col="owner" /><ColResizer index={6} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('status')} title="Trier">Statut<SortMark sort={sort} col="status" /><ColResizer index={7} cols={cols} /></th>
                      <th style={sortTh(mTh)} onClick={() => toggle('due')} title="Trier">Échéances<SortMark sort={sort} col="due" /><ColResizer index={8} cols={cols} /></th>
                      <th style={sortTh({ ...mTh, borderRight: 'none' })} onClick={() => toggle('priority')} title="Trier">Priorité<SortMark sort={sort} col="priority" /><ColResizer index={9} cols={cols} /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(({ task, step }) => {
                      const key = step ? `s${step.id}` : `t${task.id}`;
                      const open = expanded.has(key);
                      const late = due({ task, step }) && due({ task, step }) < today;
                      return (
                        <Fragment key={key}>
                          <tr style={{ background: open ? '#F5F6F8' : '#fff' }}
                            onMouseEnter={(e) => { if (!open) e.currentTarget.style.background = M.hover; }}
                            onMouseLeave={(e) => { if (!open) e.currentTarget.style.background = '#fff'; }}>
                            <td style={{ ...mTd, padding: 0 }}>
                              {task.steps.length > 0 && (
                                <button type="button" onClick={() => flip(setExpanded, key)} title={open ? 'Replier' : 'Voir toutes les étapes'}
                                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: M.sub, fontSize: 11, width: '100%', height: 36 }}>
                                  {open ? '▼' : '▶'}
                                </button>
                              )}
                            </td>
                            <td style={{ ...mTd, textAlign: 'left', cursor: 'pointer' }} title={task.title} onClick={() => onOpen(task.id)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button type="button" style={{
                                  ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 14, color: M.text, textAlign: 'left', flex: 1, minWidth: 0,
                                }}>
                                  {task.title}
                                </button>
                                <button type="button" title="Voir les commentaires" onClick={(e) => { e.stopPropagation(); setCommentsId(task.id); }}
              style={{ background: 'none', border: 'none', padding: '2px 4px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: task.comment_count ? '#0073EA' : '#C3C6D4', flexShrink: 0 }}>💬{task.comment_count ? ` ${task.comment_count}` : ''}</button>
                                {task.link_url && (
                                  <a href={task.link_url} target="_blank" rel="noreferrer" title={task.link_url} onClick={(e) => e.stopPropagation()}
                                    style={{ flexShrink: 0, color: '#0073EA', textDecoration: 'none' }}>↗</a>
                                )}
                              </span>
                            </td>
                            <td style={{ ...mTd, color: M.sub, fontSize: 13 }}>#{task.id}</td>
                            <td style={{ ...mTd, textAlign: 'left' }} title={step ? step.name : ''}>
                              {step ? (
                                <button type="button" onClick={() => onOpen(task.id)} style={{
                                  ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 14, color: M.text, textAlign: 'left', width: '100%',
                                }}>
                                  {step.name}
                                </button>
                              ) : (
                                <span style={{ fontStyle: 'italic', color: M.sub }}>Tâche sans étape</span>
                              )}
                            </td>
                            <td style={{ ...mTd, color: M.sub, fontSize: 13 }} title={task.created_at}>{formatDay(task.created_at)}</td>
                            {(() => {
                              const h = handOver({ task, step });
                              return (
                                <td style={{ ...mTd, color: M.sub, fontSize: 13, textAlign: 'left' }}
                                  title={`${h.what}${h.name ? ` par ${h.name}` : ''} — ${formatDateTime(h.at)}`}>
                                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {h.by ? <Avatar id={h.by} name={h.name} size={22} /> : null}
                                    <span style={ellipsis}>{ago(h.at)}</span>
                                  </span>
                                </td>
                              );
                            })()}
                            <td style={mTd}><AvatarStack ids={step ? step.owners : task.people} members={members} size={26} /></td>
                            <td style={mCell}>
                              {step ? (
                                <StepStatusPill cell status={step.status} onChange={(status) => act(() => tachesApi.updateStep(step.id, { status }))} />
                              ) : (
                                <TaskStatusPill cell status={task.status} onChange={(manual_status) => act(() => tachesApi.updateTask(task.id, { manual_status }))} />
                              )}
                            </td>
                            <td style={mTd}>
                              <DateRange start={step ? step.start_date : task.start_date} end={step ? step.due_date : task.due_date} late={late}
                                onChange={(b) => act(() => (step ? tachesApi.updateStep(step.id, b) : tachesApi.updateTask(task.id, b)))} />
                            </td>
                            <td style={{ ...mCell, borderRight: 'none' }}>
                              <PriorityPill cell priority={task.priority} onChange={(priority) => act(() => tachesApi.updateTask(task.id, { priority }))} />
                            </td>
                          </tr>
                          {open && (
                            <tr>
                              <td style={{ ...mTd, background: '#F5F6F8' }} />
                              <td colSpan={9} style={{ padding: '8px 12px 14px 0', borderBottom: `1px solid ${M.grid}`, background: '#F5F6F8' }}>
                                <StepsTable task={task} members={members} focusUserId={me} color={g.color}
                                  onChange={(t) => { replace(t); load(); }} onError={onError} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {!list.length && (
                      <tr><td colSpan={10} style={{ ...mTd, color: M.sub, textAlign: 'left', paddingLeft: 40, borderRight: 'none' }}>{filtering ? 'Aucun élément ne correspond aux filtres.' : 'Rien à faire pour l\'instant 🎉'}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
