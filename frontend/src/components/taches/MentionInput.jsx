import { useEffect, useRef, useState } from 'react';
import { M } from './tachesShared';
import { Avatar } from './tachesUi';

/**
 * Zone de commentaire avec mentions : taper « @ » ouvre la liste des
 * personnes (filtrée au fil des lettres) ; ↑ ↓ Entrée ou clic insère « @Nom ».
 * `onSubmit(text, mentionIds)` — seules les mentions encore présentes dans le
 * texte sont envoyées (un « @Gaïa » effacé ne prévient plus Gaïa).
 *
 * Pièces jointes, comme sur Monday : coller une capture d'écran (Ctrl+V / Cmd+V),
 * choisir un fichier (📎) ou le glisser sur la zone. `onSubmit(text, mentionIds, files)`.
 */
const MAX_FILES = 10;
const MAX_SIZE = 25 * 1024 * 1024;
const pad = (n) => String(n).padStart(2, '0');
/** Une capture collée arrive nommée « image.png » : on lui donne un nom daté. */
function named(file) {
  if (file.name && file.name !== 'image.png') return file;
  const d = new Date();
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  const name = `capture-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  return new File([file], name, { type: file.type });
}

export default function MentionInput({ members, onSubmit, placeholder }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]); // [{ id, name }]
  const [query, setQuery] = useState(null); // texte après « @ », ou null
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState([]); // [{ file, url }] — url = aperçu des images
  const [fileError, setFileError] = useState(null);
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const picker = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => () => filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url)), []);

  const addFiles = (list) => {
    const incoming = [...list].filter(Boolean).map(named);
    if (!incoming.length) return;
    const tooBig = incoming.filter((f) => f.size > MAX_SIZE);
    const ok = incoming.filter((f) => f.size <= MAX_SIZE);
    const room = Math.max(0, MAX_FILES - filesRef.current.length);
    const kept = ok.slice(0, room).map((file) => ({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }));
    setFiles((cur) => [...cur, ...kept]);
    setFileError(tooBig.length ? `Trop lourd (25 Mo maximum) : ${tooBig.map((f) => f.name).join(', ')}`
      : ok.length > room ? `${MAX_FILES} fichiers maximum par commentaire` : null);
  };
  const removeFile = (i) => setFiles((cur) => {
    if (cur[i]?.url) URL.revokeObjectURL(cur[i].url);
    return cur.filter((_, j) => j !== i);
  });
  const onPaste = (e) => {
    const pasted = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file').map((it) => it.getAsFile());
    if (!pasted.length) return; // du texte : collage normal
    e.preventDefault();
    addFiles(pasted);
  };

  const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const options = query === null ? [] : members
    .filter((m) => m.has_app !== false && fold(m.name).startsWith(fold(query)))
    .slice(0, 8);

  const detect = (value, caret) => {
    const m = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setQuery(m ? m[2] : null);
    setActive(0);
  };

  const insert = (member) => {
    const el = ref.current;
    const caret = el.selectionStart;
    const before = text.slice(0, caret).replace(/@([^\s@]*)$/, `@${member.name} `);
    const next = before + text.slice(caret);
    setText(next);
    setPicked((p) => (p.some((x) => x.id === member.id) ? p : [...p, { id: member.id, name: member.name }]));
    setQuery(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(before.length, before.length); });
  };

  const [sending, setSending] = useState(false);
  const canSend = Boolean(text.trim() || files.length) && !sending;
  const send = () => {
    const body = text.trim();
    if (!canSend) return;
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    setSending(true);
    onSubmit(body, mentions, files.map((f) => f.file)).then((ok) => {
      if (ok !== false) {
        setText(''); setPicked([]); setFileError(null);
        files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
        setFiles([]);
      }
    }).finally(() => setSending(false));
  };

  return (
    <div style={{ display: 'flex', gap: 8, position: 'relative' }}
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); } }}>
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <textarea ref={ref} value={text} rows={2} onPaste={onPaste}
          placeholder={placeholder || 'Écrire un commentaire… « @ » pour mentionner (Ctrl+Entrée pour envoyer)'}
          onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart); }}
          onClick={(e) => detect(text, e.target.selectionStart)}
          onKeyDown={(e) => {
            if (options.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % options.length); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + options.length) % options.length); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(options[active]); return; }
              if (e.key === 'Escape') { e.stopPropagation(); setQuery(null); return; }
            }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
          }}
          style={{
            width: '100%', boxSizing: 'border-box', border: `1px solid ${dragging ? '#0073EA' : M.border}`, borderRadius: 8, padding: 8,
            fontFamily: 'inherit', fontSize: 14, resize: 'vertical', outline: dragging ? '2px dashed #0073EA' : undefined,
          }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          <input ref={picker} type="file" multiple style={{ display: 'none' }}
            onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" onClick={() => picker.current?.click()} title="Joindre un fichier de votre poste (ou glissez-le ici)"
            style={{ background: 'none', border: `1px solid ${M.border}`, borderRadius: 6, padding: '3px 9px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: M.sub }}>
            📎 Joindre un fichier
          </button>
          <span style={{ fontSize: 12, color: 'var(--tk-muted)' }}>ou collez une capture d'écran (Ctrl+V / ⌘+V), ou glissez un fichier</span>
          {fileError && <span style={{ fontSize: 12, color: 'var(--tk-danger)' }}>{fileError}</span>}
        </div>
        {files.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            {files.map((f, i) => (
              <div key={`${f.file.name}-${i}`} title={f.file.name} style={{
                position: 'relative', border: `1px solid ${M.border}`, borderRadius: 8, background: 'var(--tk-bg2)',
                display: 'flex', alignItems: 'center', gap: 6, padding: f.url ? 0 : '6px 26px 6px 10px', maxWidth: 220,
              }}>
                {f.url
                  ? <img src={f.url} alt={f.file.name} style={{ display: 'block', height: 64, maxWidth: 160, objectFit: 'cover', borderRadius: 7 }} />
                  : <span style={{ fontSize: 13, color: M.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📄 {f.file.name}</span>}
                <button type="button" onClick={() => removeFile(i)} title="Retirer"
                  style={{
                    position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
                    background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 13, lineHeight: '20px', padding: 0,
                  }}>×</button>
              </div>
            ))}
          </div>
        )}
        {options.length > 0 && (
          <div data-taches-popover className="tk-pop" style={{
            position: 'absolute', left: 8, bottom: '100%', marginBottom: 4, width: 240, background: 'var(--tk-surface)', zIndex: 10,
            border: `1px solid ${M.border}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(15,23,42,0.15)', padding: 4,
          }}>
            {options.map((m, i) => (
              <button key={m.id} type="button" onMouseDown={(e) => { e.preventDefault(); insert(m); }}
                onMouseEnter={() => setActive(i)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', borderRadius: 6, cursor: 'pointer',
                  background: i === active ? 'var(--tk-sel)' : 'transparent', padding: '6px 8px', fontFamily: 'inherit', fontSize: 14, color: M.text, textAlign: 'left',
                }}>
                <Avatar id={m.id} name={m.name} size={22} />{m.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={send} disabled={!canSend} style={{
        background: '#0073EA', color: '#fff', border: 'none', borderRadius: 4, padding: '0 16px', fontSize: 14, height: 52, alignSelf: 'flex-start',
        cursor: canSend ? 'pointer' : 'default', opacity: canSend ? 1 : 0.5, fontFamily: 'inherit',
      }}>{sending ? 'Envoi…' : 'Envoyer'}</button>
    </div>
  );
}

/** Texte d'un commentaire, les « @Nom » mentionnés en bleu. */
export function CommentBody({ body, mentions = [], members }) {
  const names = mentions.map((id) => members.find((m) => m.id === id)?.name).filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!names.length) return body;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = String(body).split(new RegExp(`(@(?:${names.map(esc).join('|')}))`, 'g'));
  return parts.map((p, i) => (p.startsWith('@') && names.includes(p.slice(1))
    ? <span key={i} style={{ color: 'var(--tk-link)', background: 'var(--tk-sel)', borderRadius: 4, padding: '0 3px' }}>{p}</span>
    : p));
}
