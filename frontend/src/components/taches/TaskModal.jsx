import { useCallback, useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { tachesApi, apiError, formatDateTime, STEP_STATUS, TACHES_COLOR } from './tachesShared';
import { InlineText, PriorityPill, TaskStatusPill, Avatar } from './tachesUi';
import { btn } from './tachesShared';
import StepsTable from './StepsTable';

const label = { fontSize: 12, fontWeight: 800, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 6 };

/** Fenêtre large d'une tâche : champs, étapes, commentaires, journal. */
export default function TaskModal({ taskId, members, labels, onClose, onChanged, focusUserId }) {
  const { user, permissions, isSuperAdmin } = useContext(AuthContext);
  const canDelete = isSuperAdmin || permissions?.taches?.write === true;
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);
  const [comment, setComment] = useState('');
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

  const send = async (e) => {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      apply(await tachesApi.addComment(taskId, comment));
      setComment('');
    } catch (err) { setError(apiError(err)); }
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer définitivement « ${task.title} », ses étapes et ses commentaires ?`)) return;
    try {
      await tachesApi.deleteTask(taskId);
      onChanged?.(null);
      onClose();
    } catch (e) { setError(apiError(e)); }
  };

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.45)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto',
    }}>
      <div style={{
        background: '#fff', borderRadius: 14, width: 1100, maxWidth: '100%',
        boxShadow: '0 20px 50px rgba(0,0,0,0.25)', fontFamily: "'Lato', sans-serif",
      }}>
        {!task ? (
          <div style={{ padding: 40, color: error ? '#B91C1C' : '#6B7280' }}>{error || 'Chargement…'}</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '18px 22px', borderBottom: '1px solid #E5E7EB' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <InlineText value={task.title} onSave={(title) => save({ title })}
                  style={{ fontSize: 22, fontWeight: 800, color: '#1F2937', width: '100%' }} />
                <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 4 }}>
                  {task.updated_by_name ? `Modifiée par ${task.updated_by_name} · ` : ''}{formatDateTime(task.updated_at)}
                  {task.archived_at && <strong style={{ color: '#B45309' }}> · Archivée</strong>}
                </div>
              </div>
              <TaskStatusPill status={task.status} />
              <button type="button" onClick={onClose} title="Fermer" style={{
                background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer',
              }}>×</button>
            </div>

            <div style={{ padding: '16px 22px', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 16 }}>
              <div>
                <div style={label}>Lien</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <InlineText value={task.link_url} placeholder="Ajouter un lien" onSave={(link_url) => save({ link_url })}
                    style={{ fontSize: 14, color: '#2563EB', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} />
                  {task.link_url && <a href={task.link_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700 }}>Ouvrir ↗</a>}
                </div>
              </div>
              <div>
                <div style={label}>Étiquette</div>
                <input list="taches-labels" defaultValue={task.label || ''} key={task.label}
                  onBlur={(e) => { if ((e.target.value || '') !== (task.label || '')) save({ label: e.target.value }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                  placeholder="Fiche Produit…"
                  style={{ border: '1px solid #E5E7EB', borderRadius: 6, padding: '6px 8px', fontFamily: 'inherit', fontSize: 14, width: '100%', boxSizing: 'border-box' }} />
                <datalist id="taches-labels">{labels.map((l) => <option key={l} value={l} />)}</datalist>
              </div>
              <div>
                <div style={label}>Priorité</div>
                <PriorityPill priority={task.priority} onChange={(priority) => save({ priority })} />
              </div>
            </div>

            {error && <div style={{ margin: '0 22px 10px', padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13 }}>{error}</div>}

            <div style={{ padding: '0 22px 18px' }}>
              <div style={label}>Étapes</div>
              <div style={{ border: '1px solid #E5E7EB', borderLeft: `4px solid ${TACHES_COLOR}`, borderRadius: 8 }}>
                <StepsTable task={task} members={members} onChange={apply} onError={setError} focusUserId={focusUserId} />
              </div>
              <p style={{ fontSize: 12, color: '#9CA3AF', margin: '6px 0 0' }}>
                Passer une étape à « Fait » débloque la suivante et prévient sur Slack les personnes « À prévenir »
                (à défaut, le responsable de l'étape suivante).
              </p>
            </div>

            <div style={{ padding: '0 22px 18px' }}>
              <div style={label}>Description</div>
              <InlineText multiline value={task.description} placeholder="Ajouter une description…"
                onSave={(description) => save({ description })}
                style={{ fontSize: 14, color: '#374151', whiteSpace: 'pre-wrap', width: '100%' }} />
            </div>

            <div style={{ padding: '16px 22px', borderTop: '1px solid #E5E7EB', background: '#FAFBFC' }}>
              <div style={label}>Commentaires ({task.comments.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
                {task.comments.map((c) => (
                  <div key={c.id} style={{ display: 'flex', gap: 10 }}>
                    <Avatar id={c.user_id || 0} name={c.user_name || 'Monday'} size={30} />
                    <div style={{ flex: 1, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 12px' }}>
                      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong style={{ color: '#374151' }}>{c.user_name || 'Import Monday'}</strong> · {formatDateTime(c.created_at)}</span>
                        {c.user_id === user?.id && (
                          <button type="button" style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}
                            onClick={async () => {
                              if (!window.confirm('Supprimer ce commentaire ?')) return;
                              try { apply(await tachesApi.deleteComment(c.id)); } catch (e) { setError(apiError(e)); }
                            }}>Supprimer</button>
                        )}
                      </div>
                      <div style={{ fontSize: 14, color: '#1F2937', whiteSpace: 'pre-wrap' }}>{c.body}</div>
                    </div>
                  </div>
                ))}
              </div>
              <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2}
                  placeholder="Écrire un commentaire… (Ctrl+Entrée pour envoyer)"
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(e); }}
                  style={{ flex: 1, border: '1px solid #D1D5DB', borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
                <button type="submit" style={btn(true)} disabled={!comment.trim()}>Envoyer</button>
              </form>
            </div>

            <div style={{ padding: '12px 22px', borderTop: '1px solid #E5E7EB', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="button" style={{ ...btn(), border: 'none', color: '#6B7280' }} onClick={() => setShowLog((v) => !v)}>
                {showLog ? '▾' : '▸'} Journal ({task.events.length})
              </button>
              <span style={{ flex: 1 }} />
              <button type="button" style={btn()} onClick={() => save({ archived: !task.archived_at })}>
                {task.archived_at ? 'Désarchiver' : 'Archiver'}
              </button>
              {canDelete && (
                <button type="button" style={{ ...btn(), color: '#B91C1C', borderColor: '#FCA5A5' }} onClick={remove}>Supprimer</button>
              )}
            </div>
            {showLog && (
              <div style={{ padding: '0 22px 18px', fontSize: 13, color: '#4B5563' }}>
                {task.events.length === 0 && <div style={{ color: '#9CA3AF' }}>Rien pour l'instant.</div>}
                {task.events.map((e) => (
                  <div key={e.id} style={{ padding: '4px 0', borderBottom: '1px dashed #EEF0F3' }}>
                    <span style={{ color: '#9CA3AF' }}>{formatDateTime(e.created_at)}</span>{' · '}
                    {eventText(e, members)}
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

function eventText(e, members) {
  const d = e.detail || {};
  const names = (ids) => (ids || []).map((id) => members.find((m) => m.id === id)?.name || '?').join(', ');
  switch (e.kind) {
    case 'created': return `${e.user_name || '?'} a créé la tâche`;
    case 'status':
      return d.auto
        ? `« ${d.name} » débloquée automatiquement (${STEP_STATUS[d.to]?.label})`
        : `${e.user_name || '?'} : « ${d.name} » ${STEP_STATUS[d.from]?.label} → ${STEP_STATUS[d.to]?.label}`;
    case 'slack': return `Slack envoyé (${names(d.to)})`;
    case 'slack_error': return <span style={{ color: '#B91C1C' }}>Slack non envoyé : {d.error}</span>;
    default: return e.kind;
  }
}
