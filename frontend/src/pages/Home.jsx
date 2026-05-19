import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { APPS, SettingsIcon, LogoutIcon, GripIcon } from '../components/AppIcons';

/* ─── COULEURS ──────────────────────────────────────────── */
const C = {
  orange: '#E28F00',
  saphir: '#135E84',
  saphirF: '#003A56',
  grisTL: '#F2F6F8',
  grisCL: '#E2E2E2',
  grisM: '#8A99A4',
  grisF: '#626E85',
  grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

/* ─── PRÉFÉRENCES ───────────────────────────────────────── */
const PREFS_KEY = 'yv.home.prefs.v1';
const DEFAULT_PREFS = {
  appOrder: APPS.map(a => a.key),
  tileSize: 'comfortable',
  gridCols: 4,
};

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

const BASE_API = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

async function fetchPrefsFromServer(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${BASE_API}/users/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.home ?? null;
  } catch {
    return null;
  }
}

async function syncPrefsToServer(prefs, token) {
  if (!token) return;
  try {
    await fetch(`${BASE_API}/users/me/preferences`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ home: prefs }),
    });
  } catch {}
}

function usePrefs(token) {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const debounceRef = useRef(null);

  // Charger les prefs depuis le serveur au mount, merge si plus récent
  useEffect(() => {
    if (!token) return;
    fetchPrefsFromServer(token).then(serverPrefs => {
      if (serverPrefs) {
        setPrefs(prev => {
          const merged = { ...prev, ...serverPrefs };
          savePrefs(merged);
          return merged;
        });
      }
    });
  }, [token]);

  const update = useCallback((patch) => {
    setPrefs(prev => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      savePrefs(next);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => syncPrefsToServer(next, token), 600);
      return next;
    });
  }, [token]);

  return [prefs, update];
}

/* ─── UTILITAIRE ────────────────────────────────────────── */
function shade(hex, amt) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const adj = c => Math.max(0, Math.min(255, Math.round(c + 255 * amt)));
  const toHex = c => adj(c).toString(16).padStart(2, '0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

/* ─── DRAG SORT (pointer events — fonctionne sur les <a>) ── */
function useDragSort(order, onReorder) {
  const dragKey = useRef(null);
  const [draggingKey, setDraggingKey] = useState(null);
  const [overKey, setOverKey] = useState(null);
  // px de mouvement minimum pour déclencher le drag (évite drag accidentel au clic)
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

/* ─── APP TILE (style macOS Launchpad) ──────────────────── */
const SIZE_MAP = {
  compact:     { tile: 96,  icon: 38, label: 12, radius: 18 },
  comfortable: { tile: 124, icon: 50, label: 13, radius: 22 },
  large:       { tile: 156, icon: 62, label: 14, radius: 28 },
};

function AppTile({ app, size, isDragging, isDragOver, onPointerDown, onPointerEnter, onPointerUp, navigate }) {
  const s = SIZE_MAP[size] || SIZE_MAP.comfortable;
  const { Icon, color, path, label, key } = app;

  return (
    <div
      className={`app-tile${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
      onPointerDown={e => onPointerDown(e, key)}
      onPointerEnter={() => onPointerEnter(key)}
      onPointerUp={e => onPointerUp(e, key)}
      onClick={() => { if (!isDragging) navigate(path); }}
      style={{
        width: s.tile,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        cursor: isDragging ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
      }}
      title={label}
    >
      <div style={{
        width: s.tile,
        height: s.tile,
        borderRadius: s.radius,
        background: `linear-gradient(155deg, ${color} 0%, ${shade(color, -0.18)} 100%)`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 8px 22px ${color}38, 0 1px 0 rgba(255,255,255,0.35) inset, 0 -1px 0 rgba(0,0,0,0.18) inset`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)',
          pointerEvents: 'none',
        }} />
        <Icon size={s.icon} color="#fff" />
      </div>
      <div style={{
        fontSize: s.label,
        fontWeight: 600,
        color: C.grisTF,
        textAlign: 'center',
        maxWidth: s.tile,
        lineHeight: 1.25,
      }}>
        {label}
      </div>
    </div>
  );
}

/* ─── SIDEBAR ───────────────────────────────────────────── */
function Sidebar({ user, orderedApps, accessibleKeys, draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onLogout, navigate }) {
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
      {/* Logo */}
      <div style={{
        padding: '22px 22px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
      }}>
        <img src="/images/logo.jpg" alt="YouVape" style={{ height: 42, maxWidth: 180, objectFit: 'contain' }} />
      </div>

      {/* Spacer — pousse les apps vers le bas */}
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
                color: 'rgba(255,255,255,0.72)',
                fontSize: 13.5,
                fontWeight: 500,
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
      <div style={{
        padding: '12px 12px 6px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
      }}>
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
            width: 26,
            height: 26,
            borderRadius: 7,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
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
            width: 26,
            height: 26,
            borderRadius: 7,
            flexShrink: 0,
            background: 'rgba(222,32,32,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <LogoutIcon size={15} color="#ff8a8a" />
          </span>
          <span>Se déconnecter</span>
        </button>
      </div>

      {/* Footer utilisateur */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        gap: 11,
      }}>
        <div style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
          background: `linear-gradient(135deg, ${C.orange} 0%, ${shade(C.orange, -0.2)} 100%)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 14,
          fontWeight: 800,
          color: C.blanc,
          boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        }}>
          {initial}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 12.5,
            fontWeight: 700,
            color: C.blanc,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {user?.email?.split('@')[0] ?? ''}
          </div>
          <div style={{
            fontSize: 10.5,
            color: 'rgba(255,255,255,0.5)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {user?.email ?? ''}
          </div>
        </div>
      </div>
    </aside>
  );
}

/* ─── HOME PAGE ─────────────────────────────────────────── */
const Home = () => {
  const { user, token, logout, permissions } = useContext(AuthContext);
  const navigate = useNavigate();
  const [prefs, updatePrefs] = usePrefs(token);

  const accessibleKeys = useMemo(() => {
    if (!permissions) return [];
    return Object.entries(permissions)
      .filter(([, p]) => p?.read === true)
      .map(([k]) => k);
  }, [permissions]);

  /* Ordre courant des apps */
  const orderedApps = useMemo(() => {
    const byKey = APPS.reduce((m, a) => { m[a.key] = a; return m; }, {});
    const ordered = [];
    const seen = new Set();
    prefs.appOrder.forEach(k => {
      if (byKey[k]) { ordered.push(byKey[k]); seen.add(k); }
    });
    APPS.forEach(a => { if (!seen.has(a.key)) ordered.push(a); });
    return ordered;
  }, [prefs.appOrder]);

  const accessibleApps = orderedApps.filter(a => accessibleKeys.includes(a.key));

  /* Drag & drop via pointer events */
  const handleReorder = useCallback((newOrder) => {
    updatePrefs({ appOrder: newOrder });
  }, [updatePrefs]);

  const { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel } = useDragSort(prefs.appOrder, handleReorder);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  /* Colonnes selon la taille */
  const colTemplate = {
    compact:     'repeat(auto-fill, minmax(120px, 1fr))',
    comfortable: `repeat(${prefs.gridCols}, minmax(140px, 1fr))`,
    large:       `repeat(${Math.max(2, prefs.gridCols - 1)}, minmax(180px, 1fr))`,
  }[prefs.tileSize] || `repeat(${prefs.gridCols}, minmax(140px, 1fr))`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;500;600;700;800;900&family=Tilt+Warp&display=swap');
        .app-tile {
          transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.18s, opacity 0.15s;
        }
        .app-tile:hover { transform: translateY(-3px) scale(1.03); }
        .app-tile:active { cursor: grabbing; }
        .app-tile.dragging { opacity: 0.4; transform: scale(0.98); }
        .app-tile.drag-over { transform: scale(1.06); }
        .sb-app-row { transition: background 0.15s, color 0.15s; }
        .sb-app-row:hover { background: rgba(255,255,255,0.08) !important; color: rgba(255,255,255,0.95) !important; }
        .sb-app-row.dragging { opacity: 0.4; }
        .sb-app-row.drag-over { background: rgba(255,255,255,0.14) !important; box-shadow: inset 2px 0 0 #E28F00; }
        .main-scroll::-webkit-scrollbar { width: 8px; }
        .main-scroll::-webkit-scrollbar-track { background: transparent; }
        .main-scroll::-webkit-scrollbar-thumb { background: #E2E2E2; border-radius: 4px; }
      `}</style>

      <div
        style={{ display: 'flex', minHeight: '100vh', background: C.grisTL, fontFamily: "'Lato', sans-serif" }}
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
        />

        <main
          className="main-scroll"
          style={{
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Hero */}
          <section style={{
            padding: '48px 48px 28px',
            borderBottom: `1px solid ${C.grisCL}`,
            background: C.blanc,
          }}>
            <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
              <h1 style={{
                fontFamily: "'Tilt Warp', cursive",
                fontSize: 'clamp(28px, 3.4vw, 40px)',
                fontWeight: 900,
                color: C.saphir,
                letterSpacing: '-0.5px',
                margin: '0 0 6px',
              }}>
                Bienvenue sur YouVape Apps
              </h1>
              <p style={{ fontSize: 14, color: C.grisF, fontWeight: 500, margin: 0 }}>
                Connecté en tant que <strong style={{ color: C.grisTF }}>{user?.email}</strong>
              </p>
            </div>
          </section>

          {/* Grille des apps */}
          <section style={{ flex: 1, padding: '36px 48px 48px' }}>
            <div style={{ maxWidth: 1100, margin: '0 auto' }}>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                marginBottom: 22,
                gap: 16,
                flexWrap: 'wrap',
              }}>
                <div>
                  <h2 style={{
                    fontSize: 18,
                    fontWeight: 800,
                    color: C.grisTF,
                    marginBottom: 3,
                    fontFamily: "'Tilt Warp', cursive",
                    margin: '0 0 3px',
                  }}>
                    Applications disponibles
                  </h2>
                  <p style={{ fontSize: 12.5, color: C.grisM, fontWeight: 500, margin: 0 }}>
                    Glissez-déposez les icônes pour personnaliser l'ordre — votre disposition est sauvegardée automatiquement.
                  </p>
                </div>
                <div style={{
                  fontSize: 11,
                  color: C.grisM,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: C.grisTL,
                  borderRadius: 99,
                  flexShrink: 0,
                }}>
                  <GripIcon size={12} color={C.grisM} />
                  {accessibleApps.length} app{accessibleApps.length > 1 ? 's' : ''}
                </div>
              </div>

              {accessibleApps.length === 0 ? (
                <div style={{
                  padding: '48px 24px',
                  textAlign: 'center',
                  background: C.blanc,
                  borderRadius: 14,
                  border: `1px dashed ${C.grisCL}`,
                  color: C.grisF,
                }}>
                  <p style={{ fontSize: 15, margin: 0 }}>
                    Aucune application accessible. Contactez un administrateur pour obtenir des droits d'accès.
                  </p>
                </div>
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: colTemplate,
                  gap: prefs.tileSize === 'compact' ? 18 : prefs.tileSize === 'large' ? 32 : 26,
                  justifyItems: 'center',
                  alignItems: 'start',
                }}>
                  {accessibleApps.map(app => (
                    <AppTile
                      key={app.key}
                      app={app}
                      size={prefs.tileSize}
                      isDragging={draggingKey === app.key}
                      isDragOver={overKey === app.key && draggingKey !== app.key}
                      onPointerDown={onPointerDown}
                      onPointerEnter={onPointerEnter}
                      onPointerUp={onPointerUp}
                      navigate={navigate}
                    />
                  ))}
                </div>
              )}
            </div>
          </section>

          <footer style={{
            padding: '18px 48px',
            borderTop: `1px solid ${C.grisCL}`,
            textAlign: 'center',
            color: C.grisM,
            fontSize: 12,
          }}>
            © 2026 YouVape — Tous droits réservés
          </footer>
        </main>
      </div>
    </>
  );
};

export default Home;
