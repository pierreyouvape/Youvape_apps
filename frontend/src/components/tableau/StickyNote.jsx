import { useEffect, useRef, useState } from 'react';
import { NOTE_COLORS, noteColor } from './tableauShared';

const SAVE_DELAY_MS = 700;

/**
 * Un post-it du tableau Épinglé.
 *
 * Déplacement par la barre du haut, taille par le coin bas-droit : la position
 * bouge à l'écran pendant le geste (onLocalChange) et n'est enregistrée qu'au
 * lâcher (onSave), une seule requête par geste. Le texte s'enregistre seul,
 * 0,7 s après la dernière frappe.
 */
export default function StickyNote({ note, onLocalChange, onSave, onFront, onDelete, onSend, onColor }) {
  const c = noteColor(note.color);
  const [text, setText] = useState(note.content);
  const [menu, setMenu] = useState(false);
  const focused = useRef(false);
  const saveTimer = useRef(null);
  const pending = useRef(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Relecture du tableau : on ne remplace pas un texte en cours de frappe
  useEffect(() => {
    if (!focused.current) setText(note.content);
  }, [note.content]);

  const flush = () => {
    clearTimeout(saveTimer.current);
    if (pending.current !== null) {
      onSaveRef.current({ content: pending.current });
      pending.current = null;
    }
  };
  // Un texte tapé juste avant de quitter l'onglet part quand même
  useEffect(() => flush, []);

  const onType = (e) => {
    setText(e.target.value);
    pending.current = e.target.value;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY_MS);
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
      last = kind === 'move'
        ? { x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) }
        : { width: Math.max(140, Math.round(start.w + dx)), height: Math.max(100, Math.round(start.h + dy)) };
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

  return (
    <div
      onPointerDownCapture={onFront}
      style={{
        position: 'absolute', left: note.x, top: note.y, width: note.width, height: note.height, zIndex: note.z,
        background: c.bg, borderRadius: 6, display: 'flex', flexDirection: 'column',
        boxShadow: '0 6px 16px rgba(0,0,0,0.13), 0 1px 2px rgba(0,0,0,0.10)',
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
        <span style={{
          flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: c.ink, opacity: 0.75,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {note.received_from_name ? `De ${note.received_from_name}` : ''}
        </span>
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
              <button style={menuItem} onClick={() => { flush(); setMenu(false); onSend('move'); }}>Envoyer à…</button>
              <button style={menuItem} onClick={() => { flush(); setMenu(false); onSend('copy'); }}>Envoyer une copie à…</button>
              <button style={{ ...menuItem, color: '#B91C1C' }} onClick={() => { setMenu(false); onDelete(); }}>Supprimer</button>
            </div>
          </>
        )}
      </div>
      <textarea
        value={text}
        onChange={onType}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; flush(); }}
        placeholder="Écrire…"
        style={{
          flex: 1, minHeight: 0, resize: 'none', border: 'none', outline: 'none', background: 'transparent',
          padding: '8px 10px 14px', fontSize: 14, lineHeight: 1.4, color: c.ink, fontFamily: 'inherit',
        }}
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
