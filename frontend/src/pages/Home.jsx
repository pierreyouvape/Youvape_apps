import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { APPS, GripIcon } from '../components/AppIcons';
import AppShell, { useDragSort } from '../components/AppShell';

const C = {
  orange: '#E28F00',
  saphir: '#135E84',
  grisTL: '#F2F6F8',
  grisCL: '#E2E2E2',
  grisM: '#8A99A4',
  grisF: '#626E85',
  grisTF: '#2a2e38',
  blanc: '#FFFFFF',
};

/* ─── PRÉFÉRENCES ───────────────────────────────────────── */
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

function usePrefs(token) {
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${BASE_API}/users/me/preferences`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.home) setPrefs(prev => { const m = { ...prev, ...data.home }; savePrefs(m); return m; });
      } catch {}
    })();
  }, [token]);

  const update = useCallback((patch) => {
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

/* ─── APP TILE ──────────────────────────────────────────── */
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
      onClick={e => {
        if (isDragging) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          window.open(path, '_blank', 'noopener');
          return;
        }
        navigate(path);
      }}
      onAuxClick={e => {
        if (e.button === 1) {
          e.preventDefault();
          window.open(path, '_blank', 'noopener');
        }
      }}
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
        width: s.tile, height: s.tile, borderRadius: s.radius,
        background: `linear-gradient(155deg, ${color} 0%, ${shade(color, -0.18)} 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 8px 22px ${color}38, 0 1px 0 rgba(255,255,255,0.35) inset, 0 -1px 0 rgba(0,0,0,0.18) inset`,
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)',
          pointerEvents: 'none',
        }} />
        <Icon size={s.icon} color="#fff" />
      </div>
      <div style={{
        fontSize: s.label, fontWeight: 600, color: C.grisTF,
        textAlign: 'center', maxWidth: s.tile, lineHeight: 1.25,
      }}>
        {label}
      </div>
    </div>
  );
}

/* ─── HOME PAGE ─────────────────────────────────────────── */
const Home = () => {
  const { user, token, permissions } = useContext(AuthContext);
  const navigate = useNavigate();
  const [prefs, updatePrefs] = usePrefs(token);

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

  const accessibleApps = orderedApps.filter(a => accessibleKeys.includes(a.key));

  const handleReorder = useCallback((newOrder) => updatePrefs({ appOrder: newOrder }), [updatePrefs]);
  // On passe l'ordre affiché réel (pas prefs.appOrder) pour que les nouvelles apps
  // absentes du localStorage soient quand même déplaçables
  const displayedOrder = useMemo(() => orderedApps.map(a => a.key), [orderedApps]);
  const { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel } = useDragSort(displayedOrder, handleReorder);

  const colTemplate = {
    compact:     'repeat(auto-fill, minmax(120px, 1fr))',
    comfortable: `repeat(${prefs.gridCols}, minmax(140px, 1fr))`,
    large:       `repeat(${Math.max(2, prefs.gridCols - 1)}, minmax(180px, 1fr))`,
  }[prefs.tileSize] || `repeat(${prefs.gridCols}, minmax(140px, 1fr))`;

  return (
    <AppShell currentPath="/home">
      <style>{`
        .app-tile { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s, opacity 0.15s; }
        .app-tile:hover { transform: translateY(-3px) scale(1.03); }
        .app-tile:active { cursor: grabbing; }
        .app-tile.dragging { opacity: 0.4; transform: scale(0.98); }
        .app-tile.drag-over { transform: scale(1.06); }
      `}</style>

      <main
        className="main-scroll"
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column' }}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerUp(e, overKey)}
        onPointerCancel={onPointerCancel}
      >
        {/* Hero */}
        <section style={{ padding: '48px 48px 28px', borderBottom: `1px solid ${C.grisCL}`, background: C.blanc }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <h1 style={{
              fontFamily: "'Tilt Warp', cursive",
              fontSize: 'clamp(28px, 3.4vw, 40px)',
              fontWeight: 900, color: C.saphir, letterSpacing: '-0.5px',
              margin: '0 0 6px',
            }}>
              Bienvenue sur YouVape Apps
            </h1>
            <p style={{ fontSize: 14, color: C.grisF, fontWeight: 500, margin: 0 }}>
              Connecté en tant que <strong style={{ color: C.grisTF }}>{user?.email}</strong>
            </p>
          </div>
        </section>

        {/* Grille */}
        <section style={{ flex: 1, padding: '36px 48px 48px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: 22, gap: 16, flexWrap: 'wrap',
            }}>
              <div>
                <h2 style={{
                  fontSize: 18, fontWeight: 800, color: C.grisTF,
                  fontFamily: "'Tilt Warp', cursive", margin: '0 0 3px',
                }}>Applications disponibles</h2>
                <p style={{ fontSize: 12.5, color: C.grisM, fontWeight: 500, margin: 0 }}>
                  Glissez-déposez les icônes pour personnaliser l'ordre — votre disposition est sauvegardée automatiquement.
                </p>
              </div>
              <div style={{
                fontSize: 11, color: C.grisM, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', background: C.grisTL, borderRadius: 99, flexShrink: 0,
              }}>
                <GripIcon size={12} color={C.grisM} />
                {accessibleApps.length} app{accessibleApps.length > 1 ? 's' : ''}
              </div>
            </div>

            {accessibleApps.length === 0 ? (
              <div style={{
                padding: '48px 24px', textAlign: 'center',
                background: C.blanc, borderRadius: 14,
                border: `1px dashed ${C.grisCL}`, color: C.grisF,
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
                justifyItems: 'center', alignItems: 'start',
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
          padding: '18px 48px', borderTop: `1px solid ${C.grisCL}`,
          textAlign: 'center', color: C.grisM, fontSize: 12,
        }}>
          © 2026 YouVape — Tous droits réservés
        </footer>
      </main>
    </AppShell>
  );
};

export default Home;
