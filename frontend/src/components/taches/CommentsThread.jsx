import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../context/AuthContext';
import { tachesApi, apiError, formatDateTime } from './tachesShared';
import { Avatar } from './tachesUi';
import MentionInput, { CommentBody } from './MentionInput';

/** Fil de commentaires d'une tâche + zone de saisie (fiche et fenêtre 💬). */
export function CommentsThread({ task, members, onTask, onError, onOpenTask }) {
  const { user } = useContext(AuthContext);
  const [editingId, setEditingId] = useState(null);

  // Modification d'un commentaire (auteur seulement) : renvoie false en cas d'échec, le texte reste.
  const save = async (commentId, text, mentions) => {
    try {
      onTask(await tachesApi.updateComment(commentId, text, mentions));
      setEditingId(null);
      return true;
    } catch (err) {
      onError(apiError(err));
      return false;
    }
  };

  // Renvoie false en cas d'échec : le texte reste dans la zone pour être renvoyé.
  const send = async (text, mentions, files = []) => {
    try {
      onTask(await tachesApi.addComment(task.id, text, mentions, files));
      return true;
    } catch (err) {
      onError(apiError(err));
      return false;
    }
  };

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
        {task.comments.length === 0 && <div style={{ fontSize: 13, color: 'var(--tk-muted)' }}>Aucun commentaire.</div>}
        {task.comments.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 10 }}>
            <Avatar id={c.user_id || 0} name={c.user_name || 'Monday'} size={30} />
            <div style={{ flex: 1, minWidth: 0, background: 'var(--tk-surface)', border: '1px solid var(--tk-line)', borderRadius: 10, padding: '8px 12px' }}>
              <div style={{ fontSize: 12, color: 'var(--tk-sub)', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                <span>
                  <strong style={{ color: 'var(--tk-text2)' }}>{c.user_name || 'Import Monday'}</strong> · {formatDateTime(c.created_at)}
                  {c.edited_at && <span title={`Modifié le ${formatDateTime(c.edited_at)}`} style={{ color: 'var(--tk-muted)' }}> · modifié</span>}
                </span>
                {c.user_id === user?.id && editingId !== c.id && (
                  <span style={{ display: 'flex', gap: 4 }}>
                    <button type="button" style={{ background: 'none', border: 'none', color: 'var(--tk-muted)', cursor: 'pointer', fontSize: 12 }}
                      onClick={() => setEditingId(c.id)}>Modifier</button>
                    <button type="button" style={{ background: 'none', border: 'none', color: 'var(--tk-muted)', cursor: 'pointer', fontSize: 12 }}
                      onClick={async () => {
                        if (!window.confirm('Supprimer ce commentaire ?')) return;
                        try { onTask(await tachesApi.deleteComment(c.id)); } catch (e) { onError(apiError(e)); }
                      }}>Supprimer</button>
                  </span>
                )}
              </div>
              {editingId === c.id && (
                <div style={{ margin: '4px 0 2px' }}>
                  <MentionInput members={members} initialText={c.body} initialMentions={c.mentions} allowFiles={false}
                    submitLabel="Enregistrer" onCancel={() => setEditingId(null)}
                    onSubmit={(text, mentions) => save(c.id, text, mentions)} />
                </div>
              )}
              {c.body && editingId !== c.id && (
                <div style={{ fontSize: 14, color: 'var(--tk-text)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  <CommentBody body={c.body} mentions={c.mentions} members={members} onOpenTask={onOpenTask} />
                </div>
              )}
              {c.files?.length > 0 && <CommentFiles files={c.files} onError={onError} />}
            </div>
          </div>
        ))}
      </div>
      <MentionInput members={members} onSubmit={send} />
    </>
  );
}

/** Lit une pièce jointe avec la session (blob) ; l'adresse locale est libérée au démontage. */
function useFileUrl(file, enabled = true) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let alive = true;
    let made = null;
    tachesApi.commentFile(file).then((blob) => {
      made = URL.createObjectURL(blob);
      if (alive) setUrl(made); else URL.revokeObjectURL(made);
    }).catch(() => {});
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [file, enabled]);
  return url;
}

const sizeText = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

function ImageFile({ f }) {
  const url = useFileUrl(f.file);
  return (
    <a href={url || undefined} target="_blank" rel="noreferrer" title={`${f.name} — ouvrir en grand`}
      style={{ display: 'block', border: '1px solid var(--tk-line)', borderRadius: 8, overflow: 'hidden', background: 'var(--tk-bg2)', lineHeight: 0 }}>
      {url
        ? <img src={url} alt={f.name} style={{ display: 'block', maxWidth: 260, maxHeight: 180, objectFit: 'contain' }} />
        : <span style={{ display: 'block', width: 120, height: 80 }} />}
    </a>
  );
}

function DocFile({ f, onError }) {
  const download = async () => {
    try {
      const blob = await tachesApi.commentFile(f.file);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { onError?.(apiError(e)); }
  };
  return (
    <button type="button" onClick={download} title={`Télécharger ${f.name}`} style={{
      display: 'flex', alignItems: 'center', gap: 6, maxWidth: 260, border: '1px solid var(--tk-line)', borderRadius: 8,
      background: 'var(--tk-bg2)', padding: '6px 10px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: 'var(--tk-link)',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.name}</span>
      <span style={{ color: 'var(--tk-muted)', flexShrink: 0 }}>{sizeText(f.size || 0)}</span>
    </button>
  );
}

/** Pièces jointes d'un commentaire : vignettes pour les images, boutons de téléchargement sinon. */
function CommentFiles({ files, onError }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start', marginTop: 6 }}>
      {files.map((f) => (f.kind === 'image' ? <ImageFile key={f.file} f={f} /> : <DocFile key={f.file} f={f} onError={onError} />))}
    </div>
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
    <div className="tk-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(15,23,42,0.35)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflowY: 'auto',
    }}>
      <div className="tk-pop" style={{ background: 'var(--tk-bg2)', borderRadius: 14, width: 680, maxWidth: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.25)', fontFamily: "'Lato', sans-serif" }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--tk-line)', background: 'var(--tk-surface)', borderRadius: '14px 14px 0 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--tk-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              💬 {task ? task.title : 'Commentaires'}
            </div>
            {task && <div style={{ fontSize: 12, color: 'var(--tk-muted)' }}>#{task.id} · {task.comments.length} commentaire{task.comments.length > 1 ? 's' : ''}</div>}
          </div>
          {onOpenTask && (
            <button type="button" onClick={() => { onClose(); onOpenTask(taskId); }}
              style={{ background: 'none', border: '1px solid var(--tk-border)', borderRadius: 6, padding: '5px 10px', fontSize: 13, color: 'var(--tk-link)', cursor: 'pointer', fontFamily: 'inherit' }}>
              Ouvrir la tâche ↗
            </button>
          )}
          <button type="button" onClick={onClose} title="Fermer" style={{ background: 'none', border: 'none', fontSize: 26, lineHeight: 1, color: 'var(--tk-muted)', cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: '14px 18px' }}>
          {error && <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--tk-dangerBg)', color: 'var(--tk-danger)', borderRadius: 8, fontSize: 13 }}>{error}</div>}
          {task ? <CommentsThread task={task} members={members} onTask={apply} onError={setError}
            onOpenTask={onOpenTask ? (tid) => { onClose(); onOpenTask(tid); } : undefined} />
            : !error && <div style={{ color: 'var(--tk-sub)' }}>Chargement…</div>}
        </div>
      </div>
    </div>
  );
}
