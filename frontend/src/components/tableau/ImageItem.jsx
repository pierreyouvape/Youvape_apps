import { useState } from 'react';
import { copyImageToClipboard, apiError, TABLEAU_COLOR } from './tableauShared';

const MIN_SIZE = 40;

/**
 * Image posée seule sur le tableau. On l'attrape n'importe où pour la déplacer ;
 * sélectionnée (clic), elle montre Copier / Supprimer et une poignée de taille
 * qui garde ses proportions. Cmd+C et Suppr sont gérés par le tableau.
 */
export default function ImageItem({ item, selected, onSelect, onLocalChange, onSave, onDelete, onError }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await copyImageToClipboard(item.image_url);
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
    onSelect();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = { px: e.clientX, py: e.clientY, x: item.x, y: item.y, w: item.width, h: item.height };
    const ratio = start.w / start.h;
    let last = null;
    const move = (ev) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (kind === 'move') {
        last = { x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) };
      } else {
        const width = Math.max(MIN_SIZE, Math.round(start.w + dx));
        last = { width, height: Math.max(MIN_SIZE, Math.round(width / ratio)) };
      }
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

  const toolBtn = (danger) => ({
    border: 'none', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit', background: danger ? '#FEE2E2' : '#fff', color: danger ? '#B91C1C' : '#1F2937',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)', whiteSpace: 'nowrap',
  });

  return (
    <div style={{
      position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.z,
      outline: selected ? `3px solid ${TABLEAU_COLOR}` : 'none', outlineOffset: 2, borderRadius: 4,
    }}>
      <img
        src={item.image_url}
        alt=""
        draggable={false}
        onPointerDown={startGesture('move')}
        style={{
          width: '100%', height: '100%', objectFit: 'contain', display: 'block', borderRadius: 4,
          cursor: 'grab', touchAction: 'none', userSelect: 'none',
          boxShadow: '0 6px 16px rgba(0,0,0,0.13)', background: '#fff',
        }}
      />
      {selected && (
        <>
          <div onPointerDown={(e) => e.stopPropagation()} style={{ position: 'absolute', top: -38, left: 0, display: 'flex', gap: 6 }}>
            <button style={toolBtn(false)} onClick={copy} title="Copier (ou Cmd+C)">{copied ? 'Copiée ✓' : 'Copier'}</button>
            <button style={toolBtn(true)} onClick={onDelete} title="Supprimer (ou Suppr)">Supprimer</button>
          </div>
          <div
            onPointerDown={startGesture('resize')}
            title="Redimensionner"
            style={{
              position: 'absolute', right: -7, bottom: -7, width: 14, height: 14, borderRadius: 4,
              background: TABLEAU_COLOR, border: '2px solid #fff', cursor: 'nwse-resize', touchAction: 'none',
            }}
          />
        </>
      )}
    </div>
  );
}
