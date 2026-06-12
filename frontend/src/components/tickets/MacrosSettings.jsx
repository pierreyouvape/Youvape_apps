import { useState, useEffect, useCallback, useRef } from 'react';
import { useTicketStatuses } from './useTicketStatuses';
import { useMacroPlaceholders } from './macroPlaceholders';
import { TICKETS_COLOR } from './ticketConstants';
import RichEditor from './RichEditor';
import { markdownTextToHtml, isHtml } from './richText';

// Emojis proposés (identique au composer de réponse SAV).
const EMOJIS = ['😊','👍','🙏','😔','✅','❌','⚠️','📦','🚚','🔄','💡','📞','✉️','🎁','⏳','💰','🔍','📋','👋','😅'];

// Petit bouton d'icône de toolbar (repris du composer).
const iconBtn = () => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 30, height: 30, borderRadius: 6, border: 'none',
  background: 'transparent', cursor: 'pointer', color: '#626E85',
  fontFamily: 'Lato, sans-serif',
});

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

const API = '/api/sav';

// Aperçu texte d'un corps de macro : retire les balises HTML (les corps sont
// désormais du HTML) pour un extrait lisible dans la liste des macros.
function bodyPreview(html) {
  if (!html) return '';
  if (typeof document === 'undefined') return html.replace(/<[^>]*>/g, ' ');
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g, ' ').trim();
}

// ─── Icônes ──────────────────────────────────────────────────────────────────
const IconPlus = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const IconEdit = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);
const IconTrash = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4h6v2" />
  </svg>
);
const IconCheck = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconX = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

// ─── Bouton "Insérer une balise" avec dropdown groupé par catégorie ─────────
// Insère la balise {{key}} à la position du curseur dans l'input/textarea cible.
function InsertPlaceholderButton({ targetRef, value, onChange, groups }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const insert = (key) => {
    const token = `{{${key}}}`;
    const el = targetRef.current;
    if (!el) {
      onChange(value + token);
    } else {
      const start = el.selectionStart ?? value.length;
      const end   = el.selectionEnd   ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      // Repositionner le curseur après l'insertion
      setTimeout(() => {
        try { el.focus(); el.setSelectionRange(start + token.length, start + token.length); }
        catch { /* ignore */ }
      }, 0);
    }
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 9px', borderRadius: 6,
          border: `1px solid ${C.grisCL}`, background: open ? C.grisTL : C.blanc,
          color: TICKETS_COLOR, fontSize: 11.5, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lato, sans-serif',
        }}
        title="Insérer une balise — sera remplacée par la valeur du ticket à l'application de la macro"
      >
        {'{ } '} Insérer une balise ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 200,
          background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
          boxShadow: '0 6px 24px rgba(0,0,0,0.10)', overflow: 'hidden',
          minWidth: 280, maxHeight: 380, overflowY: 'auto',
        }}>
          {groups.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: C.grisM, textAlign: 'center' }}>Chargement…</div>
          )}
          {groups.map(group => (
            <div key={group.category}>
              <div style={{
                padding: '7px 14px 4px', fontSize: 10.5, fontWeight: 800,
                color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.6,
                background: '#FAFCFD',
              }}>{group.category}</div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => insert(item.key)}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '7px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'Lato, sans-serif',
                    display: 'flex', flexDirection: 'column', gap: 1,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize: 12.5, color: C.grisTF, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>{`{{${item.key}}}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Insertion de balise dans l'éditeur riche ───────────────────────────────
// Variante d'InsertPlaceholderButton pour Tiptap : insère {{key}} à la position
// du curseur via l'API impérative de l'éditeur (pas de selectionStart sur Tiptap).
function InsertPlaceholderRich({ editorRef, groups }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef();

  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const insert = (key) => {
    editorRef.current?.insertText(`{{${key}}}`);
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 9px', borderRadius: 6,
          border: `1px solid ${C.grisCL}`, background: open ? C.grisTL : C.blanc,
          color: TICKETS_COLOR, fontSize: 11.5, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'Lato, sans-serif',
        }}
        title="Insérer une balise — sera remplacée par la valeur du ticket à l'application de la macro"
      >
        {'{ } '} Insérer une balise ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
          background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
          boxShadow: '0 6px 24px rgba(0,0,0,0.10)', overflow: 'hidden',
          minWidth: 280, maxHeight: 380, overflowY: 'auto',
        }}>
          {groups.length === 0 && (
            <div style={{ padding: 14, fontSize: 12, color: C.grisM, textAlign: 'center' }}>Chargement…</div>
          )}
          {groups.map(group => (
            <div key={group.category}>
              <div style={{
                padding: '7px 14px 4px', fontSize: 10.5, fontWeight: 800,
                color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.6,
                background: '#FAFCFD',
              }}>{group.category}</div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => insert(item.key)}
                  style={{
                    width: '100%', textAlign: 'left', padding: '7px 14px',
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontFamily: 'Lato, sans-serif', display: 'flex', flexDirection: 'column', gap: 1,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <span style={{ fontSize: 12.5, color: C.grisTF, fontWeight: 600 }}>{item.label}</span>
                  <span style={{ fontSize: 11, color: C.grisM, fontFamily: 'monospace' }}>{`{{${item.key}}}`}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Éditeur riche du corps de macro (Tiptap + toolbar) ──────────────────────
// Même expérience que le composer de réponse : gras, italique, souligné, liste
// à puces, lien, emoji. La valeur `value`/`onChange` est du HTML.
function MacroRichBody({ value, onChange, placeholderGroups }) {
  const editorRef = useRef();
  const [fmt, setFmt] = useState({ bold: false, italic: false, underline: false, bulletList: false });
  const [showEmojis, setShowEmojis] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const emojiRef = useRef();
  const linkRef = useRef();

  useEffect(() => {
    if (!showEmojis) return;
    const h = (e) => { if (emojiRef.current && !emojiRef.current.contains(e.target)) setShowEmojis(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showEmojis]);

  useEffect(() => {
    if (!showLink) return;
    const h = (e) => { if (linkRef.current && !linkRef.current.contains(e.target)) setShowLink(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showLink]);

  const openLink = () => {
    setLinkText(editorRef.current?.getSelectedText() || '');
    setLinkUrl('');
    setShowLink(true);
  };
  const insertLink = () => {
    const url = linkUrl.trim();
    if (!url) return;
    editorRef.current?.setLink({ url, text: linkText.trim() });
    setShowLink(false);
  };

  return (
    <div style={{ border: `1px solid ${C.grisCL}`, borderRadius: 8, overflow: 'hidden', background: C.blanc }}>
      {/* Zone d'édition (hauteur fixe, scroll interne) */}
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 130, maxHeight: 260 }}>
        <RichEditor
          editorRef={editorRef}
          value={value}
          onChange={onChange}
          onStateChange={setFmt}
          placeholder="Texte qui remplacera le message en cours dans le composer…"
        />
      </div>

      {/* Toolbar */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${C.grisCL}`, position: 'relative', flexWrap: 'wrap' }}>
        <button type="button"
          style={{ ...iconBtn(), background: fmt.bold ? `${TICKETS_COLOR}1A` : 'transparent', fontWeight: 800, fontSize: 15, color: fmt.bold ? TICKETS_COLOR : C.grisF }}
          title="Gras (Ctrl/Cmd+B)"
          onMouseDown={e => { e.preventDefault(); editorRef.current?.toggleBold(); }}
        >G</button>
        <button type="button"
          style={{ ...iconBtn(), background: fmt.italic ? `${TICKETS_COLOR}1A` : 'transparent', fontStyle: 'italic', fontSize: 15, color: fmt.italic ? TICKETS_COLOR : C.grisF }}
          title="Italique (Ctrl/Cmd+I)"
          onMouseDown={e => { e.preventDefault(); editorRef.current?.toggleItalic(); }}
        >I</button>
        <button type="button"
          style={{ ...iconBtn(), background: fmt.underline ? `${TICKETS_COLOR}1A` : 'transparent', textDecoration: 'underline', fontSize: 15, color: fmt.underline ? TICKETS_COLOR : C.grisF }}
          title="Souligné (Ctrl/Cmd+U)"
          onMouseDown={e => { e.preventDefault(); editorRef.current?.toggleUnderline(); }}
        >S</button>
        <button type="button"
          style={{ ...iconBtn(), background: fmt.bulletList ? `${TICKETS_COLOR}1A` : 'transparent', fontSize: 15, color: fmt.bulletList ? TICKETS_COLOR : C.grisF }}
          title="Liste à puces"
          onMouseDown={e => { e.preventDefault(); editorRef.current?.toggleBulletList(); }}
        >☰</button>

        <span style={{ width: 1, height: 18, background: C.grisCL, margin: '0 2px' }} />

        {/* Lien */}
        <div style={{ position: 'relative' }} ref={linkRef}>
          <button type="button"
            style={{ ...iconBtn(), background: showLink ? C.grisTL : 'transparent' }}
            title="Insérer un lien"
            onClick={() => showLink ? setShowLink(false) : openLink()}
          ><span style={{ fontSize: 13, color: showLink ? TICKETS_COLOR : C.grisF }}>🔗</span></button>
          {showLink && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, zIndex: 200,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '12px 14px',
              marginBottom: 6, minWidth: 300,
            }}>
              <div style={{ fontSize: 11.5, fontWeight: 800, color: C.grisF, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Insérer un lien</div>
              <div style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Texte affiché</label>
                <input type="text" value={linkText} onChange={e => setLinkText(e.target.value)}
                  placeholder="ex. Suivre ma commande"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setShowLink(false); }}
                  style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 13, fontFamily: 'Lato, sans-serif', outline: 'none', color: C.grisTF, boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
                  onBlur={e => e.target.style.borderColor = C.grisCL}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>URL</label>
                <input autoFocus type="text" value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); insertLink(); } if (e.key === 'Escape') setShowLink(false); }}
                  style={{ width: '100%', padding: '7px 10px', border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 13, fontFamily: 'Lato, sans-serif', outline: 'none', color: C.grisTF, boxSizing: 'border-box' }}
                  onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
                  onBlur={e => e.target.style.borderColor = C.grisCL}
                />
              </div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowLink(false)}
                  style={{ padding: '7px 12px', background: 'transparent', color: C.grisF, border: `1px solid ${C.grisCL}`, borderRadius: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'Lato, sans-serif' }}
                >Annuler</button>
                <button type="button" onClick={insertLink}
                  style={{ padding: '7px 14px', background: TICKETS_COLOR, color: '#fff', border: 'none', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'Lato, sans-serif' }}
                >Insérer</button>
              </div>
            </div>
          )}
        </div>

        {/* Emoji */}
        <div style={{ position: 'relative' }} ref={emojiRef}>
          <button type="button"
            style={{ ...iconBtn(), background: showEmojis ? C.grisTL : 'transparent' }}
            title="Emoji"
            onClick={() => setShowEmojis(o => !o)}
          ><span style={{ fontSize: 14 }}>😀</span></button>
          {showEmojis && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, zIndex: 200,
              background: C.blanc, border: `1px solid ${C.grisCL}`, borderRadius: 10,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)', padding: '10px', marginBottom: 6,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
                {EMOJIS.map(emoji => (
                  <button key={emoji} type="button"
                    onClick={() => { editorRef.current?.insertText(emoji); setShowEmojis(false); }}
                    style={{ width: 36, height: 36, background: 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.1s' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{emoji}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ flex: 1 }} />
        <InsertPlaceholderRich editorRef={editorRef} groups={placeholderGroups} />
      </div>
    </div>
  );
}

// ─── Formulaire macro (création + édition) ───────────────────────────────────
function MacroForm({ initial, statuses, onSubmit, onCancel, submitLabel = 'Enregistrer' }) {
  const [name,        setName]        = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [subject,     setSubject]     = useState(initial?.subject || '');
  // Le corps est stocké/édité en HTML. Les anciennes macros (texte/markdown-like)
  // sont converties à l'ouverture pour s'afficher correctement dans l'éditeur riche.
  const [body,        setBody]        = useState(() => {
    const b = initial?.body || '';
    return isHtml(b) ? b : markdownTextToHtml(b);
  });
  const [savStatus,   setSavStatus]   = useState(initial?.sav_status || '');
  const [file,        setFile]        = useState(null);
  const [removeAttachment, setRemoveAttachment] = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');
  const fileRef = useRef();
  const subjectRef = useRef();
  const { groups: placeholderGroups } = useMacroPlaceholders();

  const existingAttachment = !removeAttachment && !file && initial?.attachment_filename
    ? {
        name: initial.attachment_original_name,
        size: initial.attachment_size,
        url:  initial.attachment_url,
      }
    : null;

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Nom requis'); return; }
    setSaving(true); setError('');
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('description', description || '');
    fd.append('subject', subject || '');
    fd.append('body', body || '');
    if (savStatus) fd.append('sav_status', savStatus);
    if (file) fd.append('attachment', file);
    else if (removeAttachment) fd.append('remove_attachment', 'true');

    const err = await onSubmit(fd);
    setSaving(false);
    if (err) setError(err);
  };

  return (
    <div style={{ background: C.blanc, borderRadius: 10, border: `2px solid ${TICKETS_COLOR}`, padding: 18, boxShadow: `0 0 0 3px ${TICKETS_COLOR}18` }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: C.grisTF, marginBottom: 16 }}>
        {initial ? 'Modifier la macro' : 'Créer une nouvelle macro'}
      </div>

      {/* Nom */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Nom *</label>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="Ex : Remboursement validé"
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
          autoFocus
        />
      </div>

      {/* Description */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Description</label>
        <input
          value={description} onChange={e => setDescription(e.target.value)}
          placeholder="Optionnel — visible dans le dropdown des macros"
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
        />
      </div>

      {/* Sujet */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5 }}>Sujet du ticket</label>
          <InsertPlaceholderButton
            targetRef={subjectRef}
            value={subject}
            onChange={setSubject}
            groups={placeholderGroups}
          />
        </div>
        <input
          ref={subjectRef}
          value={subject} onChange={e => setSubject(e.target.value)}
          placeholder="Laisser vide pour ne pas modifier le sujet"
          style={inputStyle}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
        />
      </div>

      {/* Body — éditeur riche (gras, italique, souligné, liste, lien, emoji) */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Message</label>
        <MacroRichBody
          value={body}
          onChange={setBody}
          placeholderGroups={placeholderGroups}
        />
        <div style={{ fontSize: 11, color: C.grisM, marginTop: 4 }}>
          Les balises <code style={{ fontFamily: 'monospace', background: C.grisTL, padding: '0 4px', borderRadius: 3 }}>{'{{...}}'}</code> seront remplacées par les valeurs du ticket à l'application.
        </div>
      </div>

      {/* Statut */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>
          Statut présélectionné à l'envoi
        </label>
        <select
          value={savStatus} onChange={e => setSavStatus(e.target.value)}
          style={{ ...inputStyle, cursor: 'pointer' }}
          onFocus={e => e.target.style.borderColor = TICKETS_COLOR}
          onBlur={e => e.target.style.borderColor = C.grisCL}
        >
          <option value="">— Ne pas changer le statut —</option>
          {statuses.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* PJ */}
      <div style={{ marginBottom: 18 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: C.grisM, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 5 }}>Pièce jointe</label>
        <input
          ref={fileRef} type="file"
          style={{ display: 'none' }}
          onChange={e => { setFile(e.target.files?.[0] || null); setRemoveAttachment(false); }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => fileRef.current?.click()}
            style={{ padding: '7px 12px', borderRadius: 7, border: `1px solid ${C.grisCL}`, background: C.grisTL, color: C.grisF, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
            📎 {file ? 'Changer le fichier' : (existingAttachment ? 'Remplacer le fichier' : 'Joindre un fichier')}
          </button>

          {file && (
            <span style={{ fontSize: 12, color: C.grisF }}>
              <strong>{file.name}</strong> ({(file.size / 1024).toFixed(0)} Ko)
              <button onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }}
                style={{ marginLeft: 6, background: 'none', border: 'none', color: '#B71D1D', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          )}

          {!file && existingAttachment && (
            <>
              <span style={{ fontSize: 12, color: C.grisF, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                📎 <a href={existingAttachment.url} target="_blank" rel="noopener noreferrer" style={{ color: TICKETS_COLOR, textDecoration: 'none', fontWeight: 700 }}>
                  {existingAttachment.name}
                </a>
                <span style={{ color: C.grisM }}>({((existingAttachment.size || 0) / 1024).toFixed(0)} Ko)</span>
              </span>
              <button onClick={() => setRemoveAttachment(true)}
                style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
                Supprimer
              </button>
            </>
          )}

          {!file && !existingAttachment && removeAttachment && initial?.attachment_filename && (
            <span style={{ fontSize: 12, color: '#B71D1D', fontStyle: 'italic' }}>
              La PJ sera supprimée à l'enregistrement
              <button onClick={() => setRemoveAttachment(false)} style={{ marginLeft: 6, background: 'none', border: 'none', color: TICKETS_COLOR, cursor: 'pointer', fontWeight: 600 }}>annuler</button>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 7, fontSize: 12.5, color: '#DC2626', marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleSubmit} disabled={saving || !name.trim()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 18px', borderRadius: 7, border: 'none',
            background: (!name.trim() || saving) ? C.grisM : TICKETS_COLOR,
            color: '#fff', fontSize: 13, fontWeight: 700,
            cursor: (!name.trim() || saving) ? 'not-allowed' : 'pointer',
          }}>
          <IconCheck /> {saving ? 'Enregistrement…' : submitLabel}
        </button>
        <button onClick={onCancel}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 7,
            border: `1px solid ${C.grisCL}`, background: C.blanc,
            color: C.grisF, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          }}>
          <IconX /> Annuler
        </button>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', padding: '8px 12px', border: `1px solid ${C.grisCL}`,
  borderRadius: 7, fontSize: 13.5, fontFamily: 'Lato, sans-serif',
  color: C.grisTF, outline: 'none', boxSizing: 'border-box',
  transition: 'border-color 0.12s',
};

// ─── Ligne macro ─────────────────────────────────────────────────────────────
function MacroRow({ macro, statuses, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const statusObj = macro.sav_status
    ? statuses.find(s => s.value === macro.sav_status)
    : null;

  if (editing) {
    return (
      <MacroForm
        initial={macro}
        statuses={statuses}
        submitLabel="Enregistrer"
        onCancel={() => setEditing(false)}
        onSubmit={async (fd) => {
          const err = await onSave(macro.id, fd);
          if (!err) setEditing(false);
          return err;
        }}
      />
    );
  }

  return (
    <div style={{
      background: C.blanc, border: `1px solid ${C.grisCL}`,
      borderRadius: 10, padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: C.grisTF }}>{macro.name}</span>
            {macro.attachment_filename && (
              <span style={{ fontSize: 11, fontWeight: 700, background: C.grisTL, color: C.grisF, padding: '2px 7px', borderRadius: 6 }}>
                📎 1 PJ
              </span>
            )}
            {statusObj && (
              <span style={{ fontSize: 11, fontWeight: 700, background: statusObj.bg_color, color: statusObj.text_color, padding: '2px 9px', borderRadius: 99 }}>
                → {statusObj.label}
              </span>
            )}
          </div>
          {macro.description && (
            <div style={{ fontSize: 12.5, color: C.grisF, marginBottom: 4 }}>{macro.description}</div>
          )}
          {macro.subject && (
            <div style={{ fontSize: 11.5, color: C.grisM, marginBottom: 2 }}>
              <strong style={{ color: C.grisF }}>Sujet :</strong> {macro.subject}
            </div>
          )}
          {macro.body && (() => {
            const preview = bodyPreview(macro.body);
            return preview ? (
              <div style={{ fontSize: 11.5, color: C.grisM, lineHeight: 1.4, marginTop: 4, fontStyle: 'italic', maxHeight: 36, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {preview.length > 140 ? preview.slice(0, 140) + '…' : preview}
              </div>
            ) : null;
          })()}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setEditing(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.grisTL, color: C.grisF, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
            <IconEdit /> Modifier
          </button>
          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 6, border: '1px solid #FECACA', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              <IconTrash /> Supprimer
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 600 }}>Confirmer ?</span>
              <button onClick={() => onDelete(macro.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 6, border: 'none', background: '#DC2626', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <IconCheck /> Oui
              </button>
              <button onClick={() => setConfirmDelete(false)}
                style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderRadius: 6, border: `1px solid ${C.grisCL}`, background: C.blanc, color: C.grisF, fontSize: 12, cursor: 'pointer' }}>
                <IconX />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section création repliée/dépliée ─────────────────────────────────────────
function CreateMacroForm({ statuses, onCreate }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 8,
          border: `2px dashed ${C.grisCL}`, background: C.grisTL,
          color: TICKETS_COLOR, fontSize: 13, fontWeight: 700,
          cursor: 'pointer', width: '100%', justifyContent: 'center',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = TICKETS_COLOR; e.currentTarget.style.background = '#E0F7FA'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.grisCL; e.currentTarget.style.background = C.grisTL; }}
      >
        <IconPlus /> Nouvelle macro
      </button>
    );
  }

  return (
    <MacroForm
      statuses={statuses}
      submitLabel="Créer la macro"
      onCancel={() => setOpen(false)}
      onSubmit={async (fd) => {
        const err = await onCreate(fd);
        if (!err) setOpen(false);
        return err;
      }}
    />
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function MacrosSettings() {
  const { statuses } = useTicketStatuses();
  const [macros, setMacros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchMacros = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/macros`);
      const data = await res.json();
      if (data.success) setMacros(data.macros || []);
    } catch { setError('Erreur de chargement'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchMacros(); }, [fetchMacros]);

  const handleCreate = async (fd) => {
    const res = await fetch(`${API}/macros`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur création';
    setMacros(prev => [...prev, data.macro].sort((a, b) => a.name.localeCompare(b.name)));
    return null;
  };

  const handleSave = async (id, fd) => {
    const res = await fetch(`${API}/macros/${id}`, { method: 'PUT', body: fd });
    const data = await res.json();
    if (!data.success) return data.error || 'Erreur sauvegarde';
    setMacros(prev => prev.map(m => m.id === id ? data.macro : m).sort((a, b) => a.name.localeCompare(b.name)));
    return null;
  };

  const handleDelete = async (id) => {
    await fetch(`${API}/macros/${id}`, { method: 'DELETE' });
    setMacros(prev => prev.filter(m => m.id !== id));
  };

  return (
    <>
      <div style={{
        background: `linear-gradient(135deg, ${TICKETS_COLOR}10 0%, ${TICKETS_COLOR}04 100%)`,
        border: `1px solid ${TICKETS_COLOR}30`, borderRadius: 10,
        padding: '14px 18px', marginBottom: 24,
        fontSize: 13, color: C.grisF, lineHeight: 1.6,
      }}>
        <strong style={{ color: C.grisTF }}>Macros de réponse</strong> — Créez des modèles de réponse réutilisables.
        Chaque macro peut définir un sujet, un corps de message, une pièce jointe et un statut de ticket à présélectionner.
        Appliquées depuis le composer d'un ticket via le bouton « Appliquer une macro ».
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: C.grisM }}>Chargement…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#DC2626' }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {macros.length === 0 && (
            <div style={{ padding: '20px 0', textAlign: 'center', color: C.grisM, fontSize: 13, fontStyle: 'italic' }}>
              Aucune macro pour le moment.
            </div>
          )}
          {macros.map(m => (
            <MacroRow key={m.id} macro={m} statuses={statuses} onSave={handleSave} onDelete={handleDelete} />
          ))}
          <div style={{ marginTop: 6 }}>
            <CreateMacroForm statuses={statuses} onCreate={handleCreate} />
          </div>
        </div>
      )}
    </>
  );
}
