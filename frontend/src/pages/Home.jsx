import { useState, useEffect, useRef, useCallback, useMemo, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { APPS, GripIcon, PileIcon } from '../components/AppIcons';
import AppShell, { useDragSort } from '../components/AppShell';
import { buildLauncherItems, expandItemOrder } from '../utils/launcherLayout';
import { useIsMobile } from '../hooks/useIsMobile';

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

/* ─── TAILLES ───────────────────────────────────────────
 * Desktop : tuiles à taille fixe (préférence utilisateur).
 * Mobile  : tuiles FLUIDES (largeur 100 % de la colonne de grille, carré via
 *   aspect-ratio) — une taille en dur déborderait ou laisserait des trous sur
 *   les écrans de 320 à 430 px de large.
 * ──────────────────────────────────────────────────────── */
const SIZE_MAP = {
  compact:     { tile: 96,  icon: 38, label: 12, radius: 18 },
  comfortable: { tile: 124, icon: 50, label: 13, radius: 22 },
  large:       { tile: 156, icon: 62, label: 14, radius: 28 },
};
const MOBILE_SIZE = { icon: 32, label: 11.5, radius: 18, max: 96 };

/**
 * Tuile générique du launcher : une app OU une pile. Le visuel (dégradé,
 * reflet, ombre colorée) est identique, seul le contenu de l'icône change.
 */
function LauncherTile({
  label, color, size, mobile, badge,
  isDragging, isDragOver, dragProps, onActivate, onAuxOpen, children,
}) {
  const s = SIZE_MAP[size] || SIZE_MAP.comfortable;

  const wrapStyle = mobile
    ? { width: '100%', maxWidth: MOBILE_SIZE.max }
    : { width: s.tile };

  const boxStyle = mobile
    ? { width: '100%', aspectRatio: '1 / 1', borderRadius: MOBILE_SIZE.radius }
    : { width: s.tile, height: s.tile, borderRadius: s.radius };

  return (
    <div
      className={`app-tile${isDragging ? ' dragging' : ''}${isDragOver ? ' drag-over' : ''}`}
      {...dragProps}
      onClick={onActivate}
      onAuxClick={onAuxOpen}
      style={{
        ...wrapStyle,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: mobile ? 7 : 10,
        cursor: mobile ? 'pointer' : (isDragging ? 'grabbing' : 'grab'),
        userSelect: 'none',
        // touchAction 'none' bloque le défilement tactile → desktop seulement
        // (c'est là que vit le drag-sort).
        touchAction: mobile ? 'auto' : 'none',
      }}
      title={label}
    >
      <div style={{
        ...boxStyle,
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
        {children}
        {badge != null && (
          <span style={{
            position: 'absolute', top: 6, right: 6,
            minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
            background: 'rgba(0,0,0,0.32)', color: '#fff',
            fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {badge}
          </span>
        )}
      </div>
      <div style={{
        fontSize: mobile ? MOBILE_SIZE.label : s.label,
        fontWeight: 600, color: C.grisTF,
        textAlign: 'center', width: '100%', lineHeight: 1.25,
        // Sur mobile on tronque à 2 lignes : sinon « Factures Mondial Relay »
        // désaligne toute la rangée.
        ...(mobile ? {
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } : {}),
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
  const isMobile = useIsMobile();
  const [openGroup, setOpenGroup] = useState(null);

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
  // Tuiles de premier niveau : apps seules + piles (dossiers).
  const items = useMemo(
    () => buildLauncherItems(orderedApps, accessibleKeys),
    [orderedApps, accessibleKeys],
  );

  const handleReorder = useCallback(
    // Une pile déplacée emporte ses membres : on repasse en ordre d'apps avant
    // d'enregistrer (les préférences restent exprimées en clés d'app).
    (newOrder) => updatePrefs({ appOrder: expandItemOrder(newOrder, items, orderedApps.map(a => a.key)) }),
    [updatePrefs, items, orderedApps],
  );
  // On passe l'ordre affiché réel (pas prefs.appOrder) pour que les nouvelles apps
  // absentes du localStorage soient quand même déplaçables
  const displayedOrder = useMemo(() => items.map(i => i.key), [items]);
  const { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel } = useDragSort(displayedOrder, handleReorder);

  // La pile ouverte doit suivre les permissions/l'ordre courants
  const openGroupItem = useMemo(
    () => (openGroup ? items.find(i => i.key === openGroup) ?? null : null),
    [openGroup, items],
  );

  const colTemplate = isMobile
    ? 'repeat(auto-fill, minmax(84px, 1fr))'
    : {
        compact:     'repeat(auto-fill, minmax(120px, 1fr))',
        comfortable: `repeat(${prefs.gridCols}, minmax(140px, 1fr))`,
        large:       `repeat(${Math.max(2, prefs.gridCols - 1)}, minmax(180px, 1fr))`,
      }[prefs.tileSize] || `repeat(${prefs.gridCols}, minmax(140px, 1fr))`;

  const gridGap = isMobile ? 14 : (prefs.tileSize === 'compact' ? 18 : prefs.tileSize === 'large' ? 32 : 26);

  // Handlers de drag : desktop uniquement (sur mobile, laisser le scroll tactile)
  const dragPropsFor = (key) => (isMobile ? {} : {
    onPointerDown: e => onPointerDown(e, key),
    onPointerEnter: () => onPointerEnter(key),
    onPointerUp: e => onPointerUp(e, key),
  });

  const openApp = (path) => (e) => {
    if (draggingKey) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) {
      window.open(path, '_blank', 'noopener');
      return;
    }
    navigate(path);
  };
  const auxOpen = (path) => (e) => {
    if (e.button === 1) { e.preventDefault(); window.open(path, '_blank', 'noopener'); }
  };

  const renderItem = (item, { inFolder = false } = {}) => {
    if (item.type === 'group') {
      return (
        <LauncherTile
          key={item.key}
          label={item.group.label}
          color={item.group.color}
          size={prefs.tileSize}
          mobile={isMobile}
          badge={item.apps.length}
          isDragging={draggingKey === item.key}
          isDragOver={overKey === item.key && draggingKey !== item.key}
          dragProps={dragPropsFor(item.key)}
          onActivate={() => { if (!draggingKey) setOpenGroup(item.key); }}
        >
          <PileIcon
            apps={item.apps}
            size={isMobile ? 46 : (SIZE_MAP[prefs.tileSize] || SIZE_MAP.comfortable).tile * 0.62}
          />
        </LauncherTile>
      );
    }
    const { app } = item;
    return (
      <LauncherTile
        key={app.key}
        label={app.label}
        color={app.color}
        size={prefs.tileSize}
        mobile={isMobile}
        isDragging={!inFolder && draggingKey === app.key}
        isDragOver={!inFolder && overKey === app.key && draggingKey !== app.key}
        dragProps={inFolder ? {} : dragPropsFor(app.key)}
        onActivate={openApp(app.path)}
        onAuxOpen={auxOpen(app.path)}
      >
        <app.Icon
          size={isMobile ? MOBILE_SIZE.icon : (SIZE_MAP[prefs.tileSize] || SIZE_MAP.comfortable).icon}
          color="#fff"
        />
      </LauncherTile>
    );
  };

  return (
    <AppShell currentPath="/home">
      <style>{`
        .app-tile { transition: transform 0.18s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.18s, opacity 0.15s; }
        .app-tile:hover { transform: translateY(-3px) scale(1.03); }
        .app-tile:active { cursor: grabbing; }
        .app-tile.dragging { opacity: 0.4; transform: scale(0.98); }
        .app-tile.drag-over { transform: scale(1.06); }
        /* Pas d'effet de survol au doigt (il resterait « collé » après le tap) */
        @media (hover: none) {
          .app-tile:hover { transform: none; }
          .app-tile:active { transform: scale(0.96); }
        }
      `}</style>

      <main
        className="main-scroll"
        style={{ flex: 1, minWidth: 0, overflowY: 'auto', height: '100vh', display: 'flex', flexDirection: 'column' }}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerUp(e, overKey)}
        onPointerCancel={onPointerCancel}
      >
        {/* Hero */}
        <section style={{
          padding: isMobile ? '22px 16px 16px' : '48px 48px 28px',
          borderBottom: `1px solid ${C.grisCL}`, background: C.blanc,
        }}>
          <div style={{ maxWidth: 1100, margin: '0 auto', textAlign: 'center' }}>
            <h1 style={{
              fontFamily: "'Tilt Warp', cursive",
              fontSize: isMobile ? 22 : 'clamp(28px, 3.4vw, 40px)',
              fontWeight: 900, color: C.saphir, letterSpacing: '-0.5px',
              margin: '0 0 6px',
            }}>
              Bienvenue sur YouVape Apps
            </h1>
            <p style={{
              fontSize: isMobile ? 12 : 14, color: C.grisF, fontWeight: 500, margin: 0,
              overflowWrap: 'anywhere',
            }}>
              Connecté en tant que <strong style={{ color: C.grisTF }}>{user?.email}</strong>
            </p>
          </div>
        </section>

        {/* Grille */}
        <section style={{ flex: 1, padding: isMobile ? '20px 14px 30px' : '36px 48px 48px' }}>
          <div style={{ maxWidth: 1100, margin: '0 auto' }}>
            <div style={{
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
              marginBottom: isMobile ? 16 : 22, gap: 16, flexWrap: 'wrap',
            }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{
                  fontSize: isMobile ? 16 : 18, fontWeight: 800, color: C.grisTF,
                  fontFamily: "'Tilt Warp', cursive", margin: '0 0 3px',
                }}>Applications disponibles</h2>
                {/* Le drag-sort est désactivé au doigt : ne pas promettre sur mobile */}
                <p style={{ fontSize: 12.5, color: C.grisM, fontWeight: 500, margin: 0 }}>
                  {isMobile
                    ? "Touchez une icône pour ouvrir l'app."
                    : "Glissez-déposez les icônes pour personnaliser l'ordre — votre disposition est sauvegardée automatiquement."}
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
                gap: gridGap,
                justifyItems: 'center', alignItems: 'start',
              }}>
                {items.map(item => renderItem(item))}
              </div>
            )}
          </div>
        </section>

        <footer style={{
          padding: isMobile ? '14px 16px' : '18px 48px', borderTop: `1px solid ${C.grisCL}`,
          textAlign: 'center', color: C.grisM, fontSize: 12,
        }}>
          © 2026 YouVape — Tous droits réservés
        </footer>
      </main>

      {/* Contenu d'une pile ouverte (dossier) */}
      {openGroupItem && (
        <div
          onClick={() => setOpenGroup(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500,
            background: 'rgba(15,23,42,0.55)',
            display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center',
            padding: isMobile ? 0 : 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: C.blanc,
              width: isMobile ? '100%' : 'min(560px, 100%)',
              borderRadius: isMobile ? '20px 20px 0 0' : 22,
              padding: isMobile ? '16px 16px 26px' : '24px 28px 30px',
              maxHeight: isMobile ? '80vh' : '82vh',
              overflowY: 'auto',
              boxShadow: '0 24px 60px rgba(0,0,0,0.32)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
            }}>
              <span style={{
                width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                background: `linear-gradient(155deg, ${openGroupItem.group.color} 0%, ${shade(openGroupItem.group.color, -0.18)} 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <PileIcon apps={openGroupItem.apps} size={24} />
              </span>
              <h3 style={{
                margin: 0, flex: 1, minWidth: 0,
                fontFamily: "'Tilt Warp', cursive", fontSize: isMobile ? 16 : 18,
                fontWeight: 800, color: C.grisTF,
              }}>
                {openGroupItem.group.label}
              </h3>
              <button
                onClick={() => setOpenGroup(null)}
                aria-label="Fermer"
                style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  border: `1px solid ${C.grisCL}`, background: C.grisTL,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, color: C.grisF, fontSize: 18, lineHeight: 1, fontFamily: 'inherit',
                }}
              >
                ×
              </button>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(84px, 1fr))' : 'repeat(auto-fill, minmax(130px, 1fr))',
              gap: isMobile ? 14 : 22,
              justifyItems: 'center', alignItems: 'start',
            }}>
              {openGroupItem.apps.map(app => renderItem({ type: 'app', key: app.key, app }, { inFolder: true }))}
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
};

export default Home;
