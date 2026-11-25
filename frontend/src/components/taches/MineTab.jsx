import { Fragment, useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import {
  tachesApi, apiError, ago, priorityRank, todayStr, STEP_STATUS, M, mTable, mTh, mTd, mCell, ellipsis,
} from './tachesShared';
import { PriorityPill, AvatarStack, StepStatusPill, TaskStatusPill, DateRange } from './tachesUi';
import StepsTable from './StepsTable';

const GROUPS = [
  { key: 'now', title: 'À traiter maintenant', color: '#579BFC' },
  { key: 'long', title: 'Tâches de fond', color: '#A25DDC' },
  { key: 'later', title: 'Bientôt pour moi — attend l\'étape d\'avant', color: '#DF2F4A' },
];

/**
 * Mes tâches, façon « Mon travail » de Monday : une ligne par chose à faire
 * (mon étape, ou une tâche sans étape dont je suis la personne), tous tableaux
 * confondus. La colonne « Étape d'avant » dit d'où vient le travail ; ▶ déplie
 * toute la chaîne, les étapes passées en grisé.
 */
export default function MineTab({ members, reloadKey, onOpen, onError }) {
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
  const name = (id) => members.find((m) => m.id === id)?.name || '?';

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
                <table style={{ ...mTable, minWidth: 1180 }}>
                  <colgroup>
                    <col style={{ width: 32 }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: 90 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 150 }} />
                    <col style={{ width: 120 }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th style={mTh} />
                      <th style={{ ...mTh, textAlign: 'left' }}>Mon élément</th>
                      <th style={{ ...mTh, textAlign: 'left' }}>Tâche</th>
                      <th style={{ ...mTh, textAlign: 'left' }}>Étape d'avant</th>
                      <th style={mTh}>Owner</th>
                      <th style={mTh}>Statut</th>
                      <th style={mTh}>Échéances</th>
                      <th style={{ ...mTh, borderRight: 'none' }}>Priorité</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(({ task, step }) => {
                      const key = step ? `s${step.id}` : `t${task.id}`;
                      const idx = step ? task.steps.findIndex((s) => s.id === step.id) : -1;
                      const prev = idx > 0 ? task.steps[idx - 1] : null;
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
                            <td style={{ ...mTd, textAlign: 'left' }} title={step ? step.name : task.title}>
                              <button type="button" onClick={() => onOpen(task.id)} style={{
                                ...ellipsis, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                                fontSize: 14, color: M.text, textAlign: 'left', width: '100%',
                              }}>
                                {step ? step.name : task.title}
                              </button>
                            </td>
                            <td style={{ ...mTd, textAlign: 'left', color: M.sub }} title={task.title}>
                              {step ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ ...ellipsis, flex: 1 }}>{task.title}</span>
                                  {task.comment_count > 0 && <span style={{ fontSize: 12, color: '#0073EA', flexShrink: 0 }}>💬 {task.comment_count}</span>}
                                  {task.link_url && (
                                    <a href={task.link_url} target="_blank" rel="noreferrer" title={task.link_url}
                                      style={{ flexShrink: 0, color: '#0073EA', textDecoration: 'none' }}>↗</a>
                                  )}
                                </span>
                              ) : (
                                <span style={{ fontStyle: 'italic' }}>Tâche sans étape</span>
                              )}
                            </td>
                            <td style={{ ...mTd, textAlign: 'left', color: M.sub, fontSize: 13 }}
                              title={prev ? `${prev.name} — ${STEP_STATUS[prev.status].label}${prev.done_by_name ? ` par ${prev.done_by_name} ${ago(prev.done_at)}` : ''}` : ''}>
                              {prev ? (
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STEP_STATUS[prev.status].bg, flexShrink: 0 }} />
                                  <span style={{ ...ellipsis, flex: 1 }}>
                                    {prev.name}
                                    {prev.status === 'fait'
                                      ? (prev.done_by_name ? ` · ${prev.done_by_name}, ${ago(prev.done_at)}` : '')
                                      : ` · ${prev.owners.map(name).join(', ') || 'personne'}`}
                                  </span>
                                </span>
                              ) : (step ? <span style={{ color: '#C3C6D4' }}>Première étape</span> : '')}
                            </td>
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
