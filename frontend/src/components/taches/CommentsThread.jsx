import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { tachesApi, apiError, formatDateTime } from './tachesShared';
import { Avatar } from './tachesUi';
import MentionInput, { CommentBody } from './MentionInput';

/** Fil de commentaires d'une tâche + zone de saisie (fiche et fenêtre 💬). */
export function CommentsThread({ task, members, onTask, onError }) {
  const { user } = useContext(AuthContext);

  // Renvoie false en cas d'échec : le texte reste dans la zone pour être renvoyé.
  const send = async (text, mentions) => {
    try {
      onTask(await tachesApi.addComment(task.id, text, mentions));
      return true;
    } catch (err) {
      onError(apiError(err));
      return false;
    }
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {task.comments.length === 0 && <div style={{ fontSize: 13, color: '#9CA3AF' }}>Aucun commentaire.</div>}
        {task.comments.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 10 }}>
            <Avatar id={c.user_id || 0} name={c.user_name || 'Monday'} size={30} />
            <div style={{ flex: 1, minWidth: 0, background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span><strong style={{ color: '#374151' }}>{c.user_name || 'Import Monday'}</strong> · {formatDateTime(c.created_at)}</span>
                {c.user_id === user?.id && (
                  <button type="button" style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 12 }}
                    onClick={async () => {
                      if (!window.confirm('Supprimer ce commentaire ?')) return;
                      try { onTask(await tachesApi.deleteComment(c.id)); } catch (e) { onError(apiError(e)); }
                    }}>Supprimer</button>
                )}
              </div>
              <div style={{ fontSize: 14, color: '#1F2937', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                <CommentBody body={c.body} mentions={c.mentions} members={members} />
              </div>
            </div>
          </div>
        ))}
      </div>
      <MentionInput members={members} onSubmit={send} />
    </>
  );
}

/** Fenêtre ouverte par la bulle 💬 d'une ligne : lire et répondre sans ouvrir la fiche. */
export default function CommentsPopup({ taskId, members, onClose, onChanged, onOpenTask }) {
  const [task, setTask] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    tachesApi.task(taskId).then(setTask, (e) => setError(apiError(e)));
  }, [taskId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('[data-taches-popover]')) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (t) => { setTask(t); setError(null); onChanged?.(t); };

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.35)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto',
    }}>
      <div style={{ background: '#FAFBFC', borderRadius: 14, width: 680, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', fontFamily: "'Lato', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #E5E7EB', background: '#fff', borderRadius: '14px 14px 0 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#1F2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              💬 {task ? task.title : 'Commentaires'}
            </div>
            {task && <div style={{ fontSize: 12, color: '#9CA3AF' }}>#{task.id} · {task.comments.length} commentaire{task.comments.length > 1 ? 's' : ''}</div>}
          </div>
          {onOpenTask && (
            <button type="button" onClick={() => { onClose(); onOpenTask(taskId); }}
              style={{ background: 'none', border: '1px solid #D0D4E4', borderRadius: 6, padding: '5px 10px', fontSize: 13, color: '#0073EA', cursor: 'pointer', fontFamily: 'inherit' }}>
              Ouvrir la tâche ↗
            </button>
          )}
          <button type="button" onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: '#9CA3AF', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {error && <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEE2E2', color: '#B91C1C', borderRadius: 8, fontSize: 13 }}>{error}</div>}
          {task ? <CommentsThread task={task} members={members} onTask={apply} onError={setError} />
            : !error && <div style={{ color: '#6B7280' }}>Chargement…</div>}
        </div>
      </div>
    </div>
  );
}
