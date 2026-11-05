import { useEffect, useRef, useState } from 'react';
import NoteEditor from './NoteEditor';
import { NOTE_COLORS, noteColor, tableauApi, copyImageToClipboard, apiError, formatDue, snap, MEDIA_ACCEPT } from './tableauShared';

const SAVE_DELAY_MS = 700;

/**
 * Un post-it du tableau Épinglé.
 *
 * Déplacement par la barre du haut, taille par le coin bas-droit, calés sur la
 * grille du tableau (Alt maintenu = au pixel) : la position
 * bouge à l'écran pendant le geste (onLocalChange) et n'est enregistrée qu'au
 * lâcher (onSave), une seule requête par geste. Le texte (images comprises)
 * s'enregistre seul, 0,7 s après la dernière modification.
 */
export default function StickyNote({ note, onLocalChange, onSave, onFront, onDelete, onSend, onShare, onColor, onError, onReminder, flash }) {
  const c = noteColor(note.color);
  const isOwner = note.is_owner !== false;
  const members = note.shared_with || [];
  const accepted = members.filter((m) => !m.pending);
  // Bandeau : avec qui le post-it est partagé, sinon d'où il vient
  let barLabel = note.received_from_name ? `De ${note.received_from_name}` : '';
  if (!isOwner) {
    // `accepted` me compte : les autres participants sont accepted.length - 1
    barLabel = `👥 Partagé par ${note.owner_name}`;
    if (accepted.length > 1) barLabel += ` (+${accepted.length - 1})`;
  } else if (members.length) {
    barLabel = `👥 ${accepted.map((m) => m.name).join(', ') || 'En attente'}${members.length > accepted.length ? ' …' : ''}`;
  }
  const barTitle = members.length
    ? `Partagé : ${isOwner ? 'vous' : note.owner_name}, ${members.map((m) => `${m.name}${m.pending ? ' (en attente)' : ''}`).join(', ')}`
    : barLabel;
  const [menu, setMenu] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [copied, setCopied] = useState(false);
  const saveTimer = useRef(null);
  const pending = useRef(null);
  const editorRef = useRef(null);
  const fileRef = useRef(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flush = () => {
    clearTimeout(saveTimer.current);
    if (pending.current !== null) {
      onSaveRef.current({ content: pending.current });
      pending.current = null;
    }
  };
  // Un texte tapé juste avant de quitter l'onglet part quand même
  useEffect(() => flush, []);

  const onEdit = (html) => {
    pending.current = html;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
  };

  const copySelected = async () => {
    try {
      await copyImageToClipboard(selectedImage);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      onError(apiError(e));
    }
  };

  const startGesture = (kind) => (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: note.x, y: note.y, w: note.width, h: note.height };
    let last = null;
    const move = (ev) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      const free = ev.altKey;
      last = kind === 'move'
        ? { x: Math.max(0, snap(start.x + dx, free)), y: Math.max(0, snap(start.y + dy, free)) }
        : { width: Math.max(140, snap(start.w + dx, free)), height: Math.max(100, snap(start.h + dy, free)) };
      onLocalChange(last);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (last) onSave(last);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const menuItem = {
    display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
    padding: '8px 12px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', color: '#1F2937',
  };
  const barBtn = {
    background: 'rgba(255,255,255,0.7)', border: 'none', borderRadius: 5, cursor: 'pointer', color: c.ink,
    fontSize: 11, fontWeight: 800, padding: '3px 7px', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };

  return (
    <div
      id={`tableau-note-${note.id}`}
      className={flash ? 'tableau-flash' : undefined}
      onPointerDownCapture={onFront}
      style={{
        position: 'absolute', left: note.x, top: note.y, width: note.width, height: note.height, zIndex: note.z,
        background: c.bg, color: c.ink, borderRadius: 6, display: 'flex', flexDirection: 'column',
        // Rappel arrivé : entouré de rouge jusqu'au « OK »
        boxShadow: note.remind_due
          ? '0 0 0 3px #DC2626, 0 6px 16px rgba(0,0,0,0.13)'
          : '0 6px 16px rgba(0,0,0,0.13), 0 1px 2px rgba(0,0,0,0.10)',
      }}
    >
      <div
        onPointerDown={startGesture('move')}
        style={{
          height: 28, flexShrink: 0, background: c.bar, borderRadius: '6px 6px 0 0',
          display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 0 10px',
          cursor: 'grab', touchAction: 'none', userSelect: 'none', position: 'relative',
        }}
      >
        <span title={barTitle} style={{
          flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: c.ink, opacity: 0.75,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {barLabel}
        </span>
        {note.remind_at && (
          <button onPointerDown={(e) => e.stopPropagation()} onClick={onReminder}
            title={note.remind_due ? 'Rappel arrivé : cliquer pour le fermer' : 'Modifier le rappel'}
            style={{ ...barBtn, ...(note.remind_due ? { background: '#DC2626', color: '#fff' } : {}) }}>
            ⏰ {formatDue(note.remind_at.slice(0, 10), note.remind_at.slice(11, 16))}
          </button>
        )}
        {selectedImage && (
          // onMouseDown : sans ça, le clic retire le focus de l'éditeur et
          // désélectionne l'image avant que le bouton ne la copie.
          <button onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()}
            onClick={copySelected} style={barBtn} title="Copier l'image (ou Cmd+C)">
            {copied ? 'Copiée ✓' : "Copier l'image"}
          </button>
        )}
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setMenu((m) => !m)}
          title="Options"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: c.ink,
            fontSize: 18, lineHeight: 1, padding: '0 6px', fontWeight: 800,
          }}
        >
          ⋯
        </button>
        {menu && (
          <>
            <div onPointerDown={(e) => { e.stopPropagation(); setMenu(false); }}
              style={{ position: 'fixed', inset: 0, zIndex: 1, cursor: 'default' }} />
            <div
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                position: 'absolute', top: 30, right: 4, zIndex: 2, background: '#fff', borderRadius: 10,
                boxShadow: '0 10px 28px rgba(0,0,0,0.18)', minWidth: 200, padding: '6px 0', cursor: 'default',
              }}
            >
              <div style={{ display: 'flex', gap: 6, padding: '6px 12px 8px' }}>
                {Object.entries(NOTE_COLORS).map(([key, col]) => (
                  <button
                    key={key}
                    title={key}
                    onClick={() => { onColor(key); setMenu(false); }}
                    style={{
                      width: 22, height: 22, borderRadius: 6, cursor: 'pointer', background: col.bar,
                      border: key === note.color ? `2px solid ${col.ink}` : '1px solid rgba(0,0,0,0.12)',
                    }}
                  />
                ))}
              </div>
              <button style={menuItem} onClick={() => { setMenu(false); fileRef.current?.click(); }}>Ajouter une image ou un fichier…</button>
              {isOwner && (
                <button style={menuItem} onClick={() => { flush(); setMenu(false); onReminder(); }}>{note.remind_at ? 'Modifier le rappel…' : 'Rappel…'}</button>
              )}
              <button style={menuItem} onClick={() => { flush(); setMenu(false); onShare(); }}>
                {members.length ? 'Partage…' : 'Partager avec…'}
              </button>
              {isOwner && !members.length && (
                <button style={menuItem} onClick={() => { flush(); setMenu(false); onSend('move'); }}>Envoyer à…</button>
              )}
              <button style={menuItem} onClick={() => { flush(); setMenu(false); onSend('copy'); }}>Envoyer une copie à…</button>
              <button style={{ ...menuItem, color: '#B91C1C' }} onClick={() => { setMenu(false); onDelete(); }}>
                {isOwner ? 'Supprimer' : 'Retirer de mon tableau'}
              </button>
            </div>
          </>
        )}
        <input
          ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple hidden
          onChange={(e) => { editorRef.current?.insertFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
        />
      </div>
      <NoteEditor
        ref={editorRef}
        value={note.content}
        onChange={onEdit}
        onUpload={tableauApi.uploadMedia}
        onFocusChange={(focused) => { if (!focused) flush(); }}
        onImageSelect={setSelectedImage}
        onError={(e) => onError(apiError(e))}
      />
      <div
        onPointerDown={startGesture('resize')}
        title="Redimensionner"
        style={{
          position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, cursor: 'nwse-resize',
          touchAction: 'none',
          background: `linear-gradient(135deg, transparent 50%, ${c.bar} 50%)`, borderRadius: '0 0 6px 0',
        }}
      />
    </div>
  );
}
