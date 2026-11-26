import { useRef, useState } from 'react';
import { M } from './tachesShared';
import { Avatar } from './tachesUi';

/**
 * Zone de commentaire avec mentions : taper « @ » ouvre la liste des
 * personnes (filtrée au fil des lettres) ; ↑ ↓ Entrée ou clic insère « @Nom ».
 * `onSubmit(text, mentionIds)` — seules les mentions encore présentes dans le
 * texte sont envoyées (un « @Gaïa » effacé ne prévient plus Gaïa).
 */
export default function MentionInput({ members, onSubmit, placeholder }) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState([]); // [{ id, name }]
  const [query, setQuery] = useState(null); // texte après « @ », ou null
  const [active, setActive] = useState(0);
  const ref = useRef(null);

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

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const mentions = picked.filter((p) => body.includes(`@${p.name}`)).map((p) => p.id);
    onSubmit(body, mentions).then((ok) => {
      if (ok !== false) { setText(''); setPicked([]); }
    });
  };

  return (
    <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <textarea ref={ref} value={text} rows={2}
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
          style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${M.border}`, borderRadius: 8, padding: 8, fontFamily: 'inherit', fontSize: 14, resize: 'vertical' }} />
        {options.length > 0 && (
          <div data-taches-popover style={{
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
      <button type="button" onClick={send} disabled={!text.trim()} style={{
        background: '#0073EA', color: '#fff', border: 'none', borderRadius: 4, padding: '0 16px', fontSize: 14,
        cursor: text.trim() ? 'pointer' : 'default', opacity: text.trim() ? 1 : 0.5, fontFamily: 'inherit',
      }}>Envoyer</button>
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
