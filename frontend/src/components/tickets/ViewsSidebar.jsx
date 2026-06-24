import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { TICKETS_COLOR } from './ticketConstants';
import { loadViewsOrder, saveViewsOrder, applyViewsOrder } from './viewsOrder';
import { LinkBox } from '../../utils/navHelpers';

const C = {
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4',
  grisF: '#626E85', grisTF: '#2a2e38', blanc: '#fff',
};

function IconRefresh() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={C.grisM} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 7"/><path d="M21 3v4h-4"/>
    </svg>
  );
}
function IconSettings() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke={TICKETS_COLOR} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  );
}
function IconGrip() {
  return (
    <svg width={12} height={14} viewBox="0 0 12 16" fill={C.grisCL} style={{ flexShrink: 0 }}>
      <circle cx="3.5" cy="3" r="1.5"/><circle cx="8.5" cy="3" r="1.5"/>
      <circle cx="3.5" cy="8" r="1.5"/><circle cx="8.5" cy="8" r="1.5"/>
      <circle cx="3.5" cy="13" r="1.5"/><circle cx="8.5" cy="13" r="1.5"/>
    </svg>
  );
}

export default function ViewsSidebar({ views = [], activeView, onViewChange, counts = {}, onRefresh, mobile = false, onClose }) {
  const navigate = useNavigate();

  // Ordre local (localStorage, partagé avec TicketsApp)
  const [localOrder, setLocalOrder] = useState(() => loadViewsOrder());
  const orderedViews = applyViewsOrder(views, localOrder);

  // Sync si de nouvelles vues arrivent (pas encore dans l'ordre local)
  useEffect(() => {
    const ids = views.map(v => v.id);
    const ordered = applyViewsOrder(views, localOrder).map(v => v.id);
    if (JSON.stringify(ordered) !== JSON.stringify(localOrder.filter(id => ids.includes(id)))) {
      setLocalOrder(ordered);
      saveViewsOrder(ordered);
    }
  }, [views]);

  // ─── Drag & Drop ─────────────────────────────────────────────────────────────
  const dragIdx = useRef(null);
  const [dragOver, setDragOver] = useState(null);
  const [dragging, setDragging] = useState(false);

  const handleDragStart = useCallback((e, idx) => {
    dragIdx.current = idx;
    setDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    // Image fantôme invisible — le style de drag natif est moche
    const ghost = document.createElement('div');
    ghost.style.position = 'absolute';
    ghost.style.top = '-9999px';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => document.body.removeChild(ghost), 0);
  }, []);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(idx);
  }, []);

  const handleDrop = useCallback((e, dropIdx) => {
    e.preventDefault();
    const from = dragIdx.current;
    if (from === null || from === dropIdx) { setDragOver(null); setDragging(false); return; }
    const newOrder = [...orderedViews];
    const [moved] = newOrder.splice(from, 1);
    newOrder.splice(dropIdx, 0, moved);
    const ids = newOrder.map(v => v.id);
    setLocalOrder(ids);
    saveViewsOrder(ids);
    setDragOver(null);
    setDragging(false);
    dragIdx.current = null;
  }, [orderedViews]);

  const handleDragEnd = useCallback(() => {
    setDragOver(null);
    setDragging(false);
    dragIdx.current = null;
  }, []);

  return (
    <aside style={mobile ? {
      // En tiroir : occupe tout le panneau du Drawer
      width: '100%', height: '100%', flex: 1,
      background: C.blanc,
      display: 'flex', flexDirection: 'column',
    } : {
      width: 260, minWidth: 260, flexShrink: 0,
      background: C.blanc,
      height: '100vh', position: 'sticky', top: 0,
      borderRight: `1px solid ${C.grisCL}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '18px 20px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${C.grisCL}`,
      }}>
        <h2 style={{
          fontSize: 18, fontWeight: 800, color: C.grisTF,
          fontFamily: "'Tilt Warp', cursive",
          letterSpacing: '-0.3px', margin: 0,
        }}>Vues</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            title="Rafraîchir"
            onClick={onRefresh}
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'transparent', border: 'none',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', padding: 0, transition: 'background 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = C.grisTL}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <IconRefresh />
          </button>
          {mobile && (
            <button
              title="Fermer"
              aria-label="Fermer"
              onClick={onClose}
              style={{
                width: 30, height: 30, borderRadius: 6,
                background: 'transparent', border: 'none', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 0,
              }}
            >
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={C.grisF} strokeWidth="2.2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Liste des vues — draggable */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {orderedViews.map((view, idx) => {
          const active = activeView === view.id;
          const count = counts[view.id] ?? null;
          const isOver = dragOver === idx;
          const isDraggingThis = dragging && dragIdx.current === idx;

          return (
            <div
              key={view.id}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={e => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              style={{
                display: 'flex', alignItems: 'center',
                opacity: isDraggingThis ? 0.35 : 1,
                background: isOver
                  ? `linear-gradient(90deg, ${TICKETS_COLOR}18 0%, ${TICKETS_COLOR}08 100%)`
                  : active
                  ? `linear-gradient(90deg, rgba(8,145,178,0.10) 0%, rgba(8,145,178,0.04) 100%)`
                  : 'transparent',
                boxShadow: active && !isOver ? `inset 3px 0 0 ${TICKETS_COLOR}` : isOver ? `inset 3px 0 0 ${TICKETS_COLOR}80` : 'none',
                borderTop: isOver ? `2px solid ${TICKETS_COLOR}60` : '2px solid transparent',
                transition: 'background 0.1s, opacity 0.1s',
              }}
            >
              {/* Poignée drag */}
              <div
                style={{
                  padding: '11px 6px 11px 10px',
                  cursor: 'grab',
                  display: 'flex', alignItems: 'center',
                  opacity: 0,
                  transition: 'opacity 0.15s',
                }}
                className="drag-handle"
                onMouseEnter={e => {
                  e.currentTarget.style.opacity = '1';
                  e.currentTarget.querySelector('svg circle') && null; // trigger repaint
                  e.currentTarget.querySelectorAll('circle').forEach(c => c.setAttribute('fill', C.grisM));
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.opacity = '0';
                  e.currentTarget.querySelectorAll('circle').forEach(c => c.setAttribute('fill', C.grisCL));
                }}
              >
                <IconGrip />
              </div>

              {/* Bouton vue */}
              <button
                onClick={() => onViewChange(view.id)}
                style={{
                  flex: 1, textAlign: 'left',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '11px 20px 11px 2px',
                  background: 'transparent',
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'Lato, sans-serif',
                  fontSize: 14,
                  fontWeight: active ? 700 : 400,
                  color: C.grisTF,
                }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {view.label}
                </span>
                {count !== null && (
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: active ? TICKETS_COLOR : C.grisM,
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 22, textAlign: 'right',
                  }}>
                    {count}
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.grisCL}` }}>
        <LinkBox
          to="/tickets/settings"
          display="inline-flex"
          style={{
            alignItems: 'center', gap: 6,
            fontSize: 12.5, color: TICKETS_COLOR, fontWeight: 700,
            padding: 0,
          }}
        >
          Gérer les vues
          <IconSettings />
        </LinkBox>
      </div>

      <style>{`
        div:hover > .drag-handle { opacity: 1 !important; }
      `}</style>
    </aside>
  );
}
