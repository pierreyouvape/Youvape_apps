import { useCallback, useEffect, useState } from 'react';
import { tachesApi, apiError, formatDateTime, STEP_STATUS, TASK_STATUS, TACHES_COLOR, btn, inputStyle } from './tachesShared';
import { InlineText, PriorityPill, TaskStatusPill, PeoplePicker, LabelsInput, DateRange } from './tachesUi';
import StepsTable from './StepsTable';
import { CommentsThread } from './CommentsThread';
import LinkedTasks from './LinkedTasks';

const label = { fontSize: 12, fontWeight: 800, color: 'var(--tk-muted)', textTransform: 'uppercase', marginBottom: 6 };

/** Fenêtre large d'une tâche : champs, étapes, commentaires, journal. */
export default function TaskModal({ taskId, members, labels, boards, canWrite, onClose, onChanged, focusUserId, onOpenTask }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    try {
      setTask(await tachesApi.task(taskId));
    } catch (e) {
      setError(apiError(e));
    }
  }, [taskId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-taches-popover]')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (t) => { setTask(t); setError(null); onChanged?.(t); };
  const save = async (body) => {
    try { apply(await tachesApi.updateTask(taskId, body)); } catch (e) { setError(apiError(e)); }
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement « ${task.title} », ses étapes et ses commentaires ?`)) return;
    try {
      await tachesApi.deleteTask(taskId);
      onChanged?.(null);
      onClose();
    } catch (e) { setError(apiError(e)); }
  };

  const board = task && boards.find((b) => b.id === task.board_id);

  return (
    <div className="tk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto',
    }}>
      <div className="tk-pop" style={{ background: 'var(--tk-surface)', borderRadius: 14, width: 1180, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', fontFamily: "'Lato', sans-serif" }}>
        {!task ? (
          <div style={{ padding: 40, color: error ? 'var(--tk-danger)' : 'var(--tk-sub)' }}>{error || 'Chargement…'}</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px', borderBottom: '1px solid var(--tk-line)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <InlineText value={task.title} onSave={(title) => save({ title })} style={{ fontSize: 22, fontWeight: 800, color: 'var(--tk-text)', width: '100%' }} />
                <div style={{ fontSize: 12, color: 'var(--tk-muted)', marginTop: 4 }}>
                  <span title="Numéro de la tâche (cherchable : #123)" style={{ color: 'var(--tk-sub)', fontWeight: 700 }}>#{task.id}</span>{' · '}
                  {task.updated_by_name ? `Modifiée par ${task.updated_by_name} · ` : ''}{formatDateTime(task.updated_at)}
                  {task.archived_at && <strong style={{ color: 'var(--tk-warn)' }}> · Archivée le {formatDateTime(task.archived_at)}</strong>}
                </div>
              </div>
              <TaskStatusPill status={task.status} onChange={task.steps.length ? undefined : (manual_status) => save({ manual_status })} />
              <button type="button" onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: 'var(--tk-muted)', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: '16px 22px', display: 'grid', gridTemplateColumns: '2fr 1.4fr 1fr 1fr', gap: 16 }}>
              <div>
                <div style={label}>Lien</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <InlineText value={task.link_url} placeholder="Ajouter un lien" onSave={(link_url) => save({ link_url })}
                    style={{ fontSize: 14, color: 'var(--tk-link)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                  {task.link_url && <a href={task.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700 }}>Ouvrir ↗</a>}
                </div>
              </div>
              <div>
                <div style={label}>Étiquettes</div>
                <LabelsInput value={task.labels} suggestions={labels} onChange={(l) => save({ labels: l })} />
              </div>
              <div>
                <div style={label}>Personne(s)</div>
                <PeoplePicker title="Personne(s) de la tâche" value={task.people} members={members} onChange={(people) => save({ people })} />
              </div>
              <div>
                <div style={label}>Priorité</div>
                <PriorityPill priority={task.priority} onChange={(priority) => save({ priority })} />
              </div>
              <div>
                <div style={label}>Dates</div>
                <DateRange start={task.start_date} end={task.due_date} onChange={save} />
              </div>
              <div>
                <div style={label}>Tableau</div>
                <select value={task.board_id} onChange={(e) => save({ board_id: Number(e.target.value) })} style={{ ...inputStyle, padding: '6px 8px' }}>
                  {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <div style={label}>Groupe</div>
                <select value={task.group_id || ''} onChange={(e) => save({ group_id: Number(e.target.value) })} style={{ ...inputStyle, padding: '6px 8px' }}>
                  {(board?.groups || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
              {!task.steps.length && (
                <div style={{ fontSize: 12, color: 'var(--tk-sub)', alignSelf: 'end' }}>
                  Sans étape : statut choisi à la main ({TASK_STATUS[task.manual_status]?.label}).
                </div>
              )}
            </div>

            {error && <div style={{ margin: '0 22px 10px', padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>}

            <div style={{ padding: '0 22px 18px' }}>
              <div style={label}>Description</div>
              <InlineText multiline value={task.description} placeholder="Ajouter une description…" onSave={(description) => save({ description })}
                style={{ fontSize: 14, color: 'var(--tk-text2)', whiteSpace: 'pre-wrap', width: '100%' }} />
            </div>

            <LinkedTasks task={task} onTask={apply} onError={setError} onOpenTask={onOpenTask} />

            <div style={{ padding: '16px 22px', borderTop: '1px solid var(--tk-line)', borderBottom: '1px solid var(--tk-line)', background: 'var(--tk-bg2)', marginBottom: 16 }}>
              <div style={label}>Commentaires ({task.comments.length})</div>
              <CommentsThread task={task} members={members} onTask={apply} onError={setError} onOpenTask={onOpenTask} />
            </div>

            <div style={{ padding: '0 22px 18px' }}>
              <div style={label}>Étapes</div>
              <div style={{ border: '1px solid var(--tk-line)', borderLeft: `4px solid ${TACHES_COLOR}`, borderRadius: 8 }}>
                <StepsTable task={task} members={members} onChange={apply} onError={setError} focusUserId={focusUserId} />
              </div>
              <p style={{ fontSize: 12, color: 'var(--tk-muted)', margin: '6px 0 0' }}>
                Passer une étape à « Fait » débloque la suivante et prévient sur Slack les personnes « À prévenir »
                (à défaut, le responsable de l'étape suivante). 🗑 supprime une étape.
              </p>
            </div>

            <div style={{ padding: '12px 22px', borderTop: '1px solid var(--tk-line)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={{ ...btn(), border: 'none', color: 'var(--tk-sub)' }} onClick={() => setShowLog((v) => !v)}>
                {showLog ? '▾' : '▸'} Journal ({task.events.length})
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" style={btn()} onClick={() => save({ archived: !task.archived_at })}>
                {task.archived_at ? '↩ Désarchiver' : '🗄 Archiver'}
              </button>
              {canWrite ? (
                <button type="button" style={{ ...btn(), color: 'var(--tk-danger)', borderColor: 'var(--tk-dangerLine)' }} onClick={remove}>🗑 Supprimer la tâche</button>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--tk-muted)' }}>Supprimer : droit d'écriture requis</span>
              )}
            </div>
            {showLog && (
              <div style={{ padding: '0 22px 18px', fontSize: 13, color: 'var(--tk-text2)' }}>
                {task.events.length === 0 && <div style={{ color: 'var(--tk-muted)' }}>Rien pour l'instant.</div>}
                {task.events.map((e) => (
                  <div key={e.id} style={{ padding: '4px 0', borderBottom: '1px dashed var(--tk-line2)' }}>
                    <span style={{ color: 'var(--tk-muted)' }}>{formatDateTime(e.created_at)}</span>{' · '}{eventText(e, members)}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const LINK_LABEL = { relates: 'liée à', blocks: 'bloque', blocked_by: 'bloquée par' };

function eventText(e, members) {
  const d = e.detail || {};
  const names = (ids) => (ids || []).map((id) => members.find((m) => m.id === id)?.name || '?').join(', ');
  switch (e.kind) {
    case 'created': return `${e.user_name || '?'} a créé la tâche`;
    case 'status':
      return d.auto
        ? `« ${d.name} » débloquée automatiquement (${STEP_STATUS[d.to]?.label})`
        : `${e.user_name || '?'} : « ${d.name} » ${STEP_STATUS[d.from]?.label} → ${STEP_STATUS[d.to]?.label}`;
    case 'task_status': return `${e.user_name || '?'} : statut ${TASK_STATUS[d.from]?.label} → ${TASK_STATUS[d.to]?.label}`;
    case 'linked': return `${e.user_name || '?'} a lié la tâche #${d.id}${d.title ? ` « ${d.title} »` : ''} (${LINK_LABEL[d.kind] || 'liée à'})`;
    case 'unlinked': return `${e.user_name || '?'} a retiré le lien avec la tâche #${d.id}`;
    case 'step_deleted': return `${e.user_name || '?'} a supprimé l'étape « ${d.name} »`;
    case 'slack': return `Slack envoyé${d.to?.length ? ` (${names(d.to)})` : ''}`;
    case 'slack_error': return <span style={{ color: 'var(--tk-danger)' }}>Slack non envoyé : {d.error}</span>;
    default: return e.kind;
  }
}
