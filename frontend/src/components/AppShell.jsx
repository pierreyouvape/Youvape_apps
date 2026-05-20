import { useState, useRef, useCallback, useMemo, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { APPS, SettingsIcon, LogoutIcon } from './AppIcons';

const C = {
  orange: '#E28F00',
  saphirF: '#003A56',
  grisCL: '#E2E2E2',
  grisM: '#8A99A4',
  grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* ─── DRAG SORT (pointer events) ──────────────────────────── */
export function useDragSort(order, onReorder) {
  const dragKey = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  const startPos = useRef(null);
  const THRESHOLD = 6;

  const onPointerDown = useCallback((e, key) => {
    if (e.button !== 0) return;
    startPos.current = { x: e.clientX, y: e.clientY };
    dragKey.current = key;
  }, []);

  const onPointerEnter = useCallback((key) => {
    if (!draggingKey) return;
    setOverKey(key);
  }, [draggingKey]);

  const onPointerUp = useCallback((e, key) => {
    if (!draggingKey) {
      dragKey.current = null;
      startPos.current = null;
      return;
    }
    e.preventDefault();
    const from = dragKey.current;
    const to = key;
    if (from && to && from !== to) {
      const newOrder = [...order];
      const fi = newOrder.indexOf(from);
      const ti = newOrder.indexOf(to);
      if (fi !== -1 && ti !== -1) {
        newOrder.splice(fi, 1);
        newOrder.splice(ti, 0, from);
        onReorder(newOrder);
      }
    }
    dragKey.current = null;
    startPos.current = null;
    setDraggingKey(null);
    setOverKey(null);
  }, [draggingKey, order, onReorder]);

  const onPointerMove = useCallback((e) => {
    if (!dragKey.current || draggingKey) return;
    const dx = e.clientX - (startPos.current?.x ?? e.clientX);
    const dy = e.clientY - (startPos.current?.y ?? e.clientY);
    if (Math.sqrt(dx * dx + dy * dy) > THRESHOLD) {
      setDraggingKey(dragKey.current);
    }
  }, [draggingKey]);

  const onPointerCancel = useCallback(() => {
    dragKey.current = null;
    startPos.current = null;
    setDraggingKey(null);
    setOverKey(null);
  }, []);

  return { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel };
}

/* ─── SIDEBAR ──────────────────────────────────────────────── */
function Sidebar({ user, orderedApps, accessibleKeys, draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onLogout, navigate, currentPath, appMenu }) {
  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <aside style={{
      width: 260,
      minWidth: 260,
      flexShrink: 0,
      background: C.saphirF,
      height: '100vh',
      position: 'sticky',
      top: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.06)',
    }}>
      {/* Logo + bouton Accueil */}
      <div style={{
        padding: '22px 22px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
      }}>
        <img src="/images/logo.jpg" alt="YouVape" style={{ height: 42, maxWidth: 140, objectFit: 'contain', flexShrink: 1, minWidth: 0 }} />
        <button
          onClick={() => navigate('/home')}
          title="Accueil"
          style={{
            flexShrink: 0,
            width: 32, height: 32, borderRadius: 8,
            background: currentPath === '/home' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', padding: 0,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = currentPath === '/home' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </button>
      </div>

      {/* Menu interne de l'app (optionnel) */}
      {appMenu && (
        <div style={{ padding: '14px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {appMenu}
        </div>
      )}

      {/* Spacer */}
      <div style={{ flex: 1, minHeight: 0 }} />

      {/* Liste des apps */}
      <div style={{ overflowY: 'auto', padding: '14px 12px', maxHeight: '55vh' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          padding: '4px 10px 10px',
        }}>
          Applications
        </div>

        {orderedApps.filter(a => accessibleKeys.includes(a.key)).map(app => {
          const { Icon, color, path, label, key } = app;
          const isDrag = draggingKey === key;
          const isOver = overKey === key && draggingKey !== key;
          const isActive = currentPath === path || currentPath?.startsWith(path + '/');
          return (
            <div
              key={key}
              onPointerDown={e => onPointerDown(e, key)}
              onPointerEnter={() => onPointerEnter(key)}
              onPointerUp={e => onPointerUp(e, key)}
              onClick={() => { if (!draggingKey) navigate(path); }}
              className={`sb-app-row${isDrag ? ' dragging' : ''}${isOver ? ' drag-over' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '9px 10px',
                borderRadius: 8,
                marginBottom: 1,
                background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: isActive ? C.blanc : 'rgba(255,255,255,0.72)',
                fontSize: 13.5,
                fontWeight: isActive ? 700 : 500,
                cursor: isDrag ? 'grabbing' : 'grab',
                userSelect: 'none',
                touchAction: 'none',
              }}
            >
              <span style={{
                width: 26,
                height: 26,
                borderRadius: 7,
                flexShrink: 0,
                background: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 1px 0 rgba(255,255,255,0.25) inset',
              }}>
                <Icon size={16} color="#fff" />
              </span>
              <span style={{
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                flex: 1,
                minWidth: 0,
              }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Compte */}
      <div style={{ padding: '12px 12px 6px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.12em',
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          padding: '4px 10px 8px',
        }}>
          Compte
        </div>

        <Link
          to="/settings"
          className="sb-app-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '9px 10px',
            borderRadius: 8,
            marginBottom: 1,
            color: 'rgba(255,255,255,0.78)',
            fontSize: 13.5,
            fontWeight: 500,
            textDecoration: 'none',
            cursor: 'pointer',
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: 'rgba(255,255,255,0.08)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <SettingsIcon size={15} color="rgba(255,255,255,0.85)" />
          </span>
          <span>Paramètres</span>
        </Link>

        <button
          onClick={onLogout}
          className="sb-app-row"
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: '9px 10px',
            borderRadius: 8,
            marginBottom: 6,
            color: 'rgba(255,255,255,0.78)',
            fontSize: 13.5,
            fontWeight: 500,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <span style={{
            width: 26, height: 26, borderRadius: 7, flexShrink: 0,
            background: 'rgba(222,32,32,0.18)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <LogoutIcon size={15} color="#ff8a8a" />
          </span>
          <span>Se déconnecter</span>
        </button>
      </div>

      {/* Footer user */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${C.orange} 0%, ${shade(C.orange, -0.2)} 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 800, color: C.blanc,
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}>
          {initial}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 12.5, fontWeight: 700, color: C.blanc,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {user?.email?.split('@')[0] ?? ''}
          </div>
          <div style={{
            fontSize: 10.5, color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {user?.email ?? ''}
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ─── PREFS (localStorage + API) ─────────────────────────── */
const PREFS_KEY = 'yv.home.prefs.v1';
const DEFAULT_PREFS = { appOrder: APPS.map(a => a.key), tileSize: 'comfortable', gridCols: 4 };
const BASE_API = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {} }

/* ─── APPSHELL ─────────────────────────────────────────────
 * Props :
 *   appMenu     ReactNode — menu interne sous le logo (optionnel)
 *   currentPath string    — pour surligner l'app active
 *   children    ReactNode — contenu principal
 * ──────────────────────────────────────────────────────── */
export default function AppShell({ appMenu, currentPath, children }) {
  const { user, token, logout, permissions } = useContext(AuthContext);
  const navigate = useNavigate();

  const [prefs, setPrefs] = useState(() => loadPrefs());
  const debounceRef = useRef(null);

  const updatePrefs = useCallback((patch) => {
    setPrefs(prev => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!token) return;
        try {
          await fetch(`${BASE_API}/users/me/preferences`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ home: next }),
          });
        } catch {}
      }, 600);
      return next;
    });
  }, [token]);

  const accessibleKeys = useMemo(() => {
    if (!permissions) return [];
    return Object.entries(permissions).filter(([, p]) => p?.read === true).map(([k]) => k);
  }, [permissions]);

  const orderedApps = useMemo(() => {
    const byKey = APPS.reduce((m, a) => { m[a.key] = a; return m; }, {});
    const ordered = []; const seen = new Set();
    prefs.appOrder.forEach(k => { if (byKey[k]) { ordered.push(byKey[k]); seen.add(k); } });
    APPS.forEach(a => { if (!seen.has(a.key)) ordered.push(a); });
    return ordered;
  }, [prefs.appOrder]);

  const handleReorder = useCallback((newOrder) => updatePrefs({ appOrder: newOrder }), [updatePrefs]);
  const { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel } = useDragSort(prefs.appOrder, handleReorder);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;500;600;700;800;900&family=Tilt+Warp&display=swap');
        .sb-app-row { transition: background 0.15s, color 0.15s; }
        .sb-app-row:hover { background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.95) !important; }
        .sb-app-row.dragging { opacity: 0.4; }
        .sb-app-row.drag-over { background: rgba(255,255,255,0.14) !important; box-shadow: inset 2px 0 0 #E28F00; }
        .main-scroll::-webkit-scrollbar { width: 8px; }
        .main-scroll::-webkit-scrollbar-track { background: transparent; }
        .main-scroll::-webkit-scrollbar-thumb { background: #E2E2E2; border-radius: 4px; }
      `}</style>
      <div
        style={{ display: 'flex', minHeight: '100vh', background: '#F2F6F8', fontFamily: "'Lato', sans-serif" }}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerUp(e, overKey)}
        onPointerCancel={onPointerCancel}
      >
        <Sidebar
          user={user}
          orderedApps={orderedApps}
          accessibleKeys={accessibleKeys}
          draggingKey={draggingKey}
          overKey={overKey}
          onPointerDown={onPointerDown}
          onPointerEnter={onPointerEnter}
          onPointerUp={onPointerUp}
          onLogout={handleLogout}
          navigate={navigate}
          currentPath={currentPath}
          appMenu={appMenu}
        />
        {children}
      </div>
    </>
  );
}
