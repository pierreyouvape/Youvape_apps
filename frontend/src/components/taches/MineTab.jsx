import { Fragment, useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import {
  tachesApi, apiError, priorityRank, todayStr, formatDay, M, mTable, mTh, mTd, mCell, ellipsis,
} from './tachesShared';
import { PriorityPill, AvatarStack, StepStatusPill, TaskStatusPill, DateRange, ColGroup, ColResizer } from './tachesUi';
import { useColumnWidths } from './tachesColumns';
import StepsTable from './StepsTable';

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
  const cols = useColumnWidths('mine', [32, 420, 300, 120, 90, 150, 150, 120]);
  const { user } = useContext(AuthContext);
  const me = user?.id;
  const [tasks, setTasks] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [closed, setClosed] = useState(() => new Set());

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
  const cmp = (a, b) => priorityRank(a.task.priority) - priorityRank(b.task.priority)
    || (due(a) || '9999').localeCompare(due(b) || '9999') || b.task.updated_at.localeCompare(a.task.updated_at);
  const bucket = {
    now: rows.filter((r) => !['bloque', 'longue'].includes(stateOf(r))).sort(cmp),
    long: rows.filter((r) => stateOf(r) === 'longue').sort(cmp),
    later: rows.filter((r) => stateOf(r) === 'bloque').sort(cmp),
  };

  return (
    <div style={{ fontFamily: M.font, color: M.text }}>
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
                      <th style={{ ...mTh, textAlign: 'left' }}>Tâche<ColResizer index={1} cols={cols} /></th>
                      <th style={{ ...mTh, textAlign: 'left' }}>Mon étape<ColResizer index={2} cols={cols} /></th>
                      <th style={mTh}>Créée le<ColResizer index={3} cols={cols} /></th>
                      <th style={mTh}>Owner<ColResizer index={4} cols={cols} /></th>
                      <th style={mTh}>Statut<ColResizer index={5} cols={cols} /></th>
                      <th style={mTh}>Échéances<ColResizer index={6} cols={cols} /></th>
                      <th style={{ ...mTh, borderRight: 'none' }}>Priorité<ColResizer index={7} cols={cols} /></th>
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
                            <td style={{ ...mTd, textAlign: 'left' }} title={task.title}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button type="button" onClick={() => onOpen(task.id)} style={{
                                  ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                  fontSize: 14, color: M.text, textAlign: 'left', flex: 1, minWidth: 0,
                                }}>
                                  {task.title}
                                </button>
                                {task.comment_count > 0 && <span style={{ fontSize: 12, color: '#0073EA', flexShrink: 0 }}>💬 {task.comment_count}</span>}
                                {task.link_url && (
                                  <a href={task.link_url} target="_blank" rel="noreferrer" title={task.link_url}
                                    style={{ flexShrink: 0, color: '#0073EA', textDecoration: 'none' }}>↗</a>
                                )}
                              </span>
                            </td>
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
                              <td colSpan={7} style={{ padding: '8px 12px 14px 0', borderBottom: `1px solid ${M.grid}`, background: '#F5F6F8' }}>
                                <StepsTable task={task} members={members} focusUserId={me} color={g.color}
                                  onChange={(t) => { replace(t); load(); }} onError={onError} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {!list.length && (
                      <tr><td colSpan={8} style={{ ...mTd, color: M.sub, textAlign: 'left', paddingLeft: 40, borderRight: 'none' }}>Rien à faire pour l'instant 🎉</td></tr>
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
