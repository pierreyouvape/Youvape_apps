import { useState, useRef, useCallback, useMemo, useContext, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { APPS, SettingsIcon, LogoutIcon } from './AppIcons';
import { LinkBox } from '../utils/navHelpers';
import Drawer from './Drawer';
import { useIsMobile } from '../hooks/useIsMobile';

// Apps ayant une page de paramètres dédiée
const APP_SETTINGS_PATHS = {
  tickets: '/tickets/settings',
};

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
function Sidebar({ user, orderedApps, accessibleKeys, draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onLogout, navigate, currentPath, appMenu, collapsed, onToggleCollapse, mobile = false }) {
  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <aside style={{
      width: collapsed ? 68 : 260,
      minWidth: collapsed ? 68 : 260,
      flexShrink: 0,
      background: C.saphirF,
      height: '100vh',
      position: 'sticky',
      top: 0,
      display: 'flex',
      flexDirection: 'column',
      borderRight: '1px solid rgba(255,255,255,0.06)',
      transition: 'width 0.18s ease, min-width 0.18s ease',
    }}>
      {/* Logo + bouton Accueil + toggle */}
      <div style={{
        padding: collapsed ? '18px 0 14px' : '22px 22px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap: 10,
      }}>
        {!collapsed && (
          <img src="/images/logo.jpg" alt="YouVape" style={{ height: 42, maxWidth: 140, objectFit: 'contain', flexShrink: 1, minWidth: 0 }} />
        )}
        {!collapsed && (
          <LinkBox
            to="/home"
            title="Accueil"
            display="flex"
            style={{
              flexShrink: 0,
              width: 32, height: 32, borderRadius: 8,
              background: currentPath === '/home' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.12)',
              alignItems: 'center', justifyContent: 'center',
              padding: 0,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
            onMouseLeave={e => e.currentTarget.style.background = currentPath === '/home' ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)'}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </LinkBox>
        )}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          aria-label={collapsed ? 'Déplier le menu' : 'Replier le menu'}
          style={{
            flexShrink: 0,
            width: 32, height: 32, borderRadius: 8,
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      {/* Bloc app active : titre + bouton paramètres */}
      {!collapsed && (() => {
        const activeApp = APPS.find(a => currentPath === a.path || currentPath?.startsWith(a.path + '/'));
        const settingsPath = activeApp ? APP_SETTINGS_PATHS[activeApp.key] : null;
        if (!activeApp || currentPath === '/home') return null;
        return (
          <div style={{
            padding: '14px 16px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            {/* Titre de l'app */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9, marginBottom: settingsPath ? 10 : 0,
            }}>
              <span style={{
                width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                background: activeApp.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 1px 0 rgba(255,255,255,0.25) inset',
              }}>
                <activeApp.Icon size={17} color="#fff" />
              </span>
              <span style={{
                fontSize: 14, fontWeight: 800, color: '#fff',
                fontFamily: "'Tilt Warp', cursive",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                flex: 1,
              }}>
                {activeApp.label}
              </span>
            </div>
            {/* Bouton paramètres de l'app */}
            {settingsPath && (
              <LinkBox
                to={settingsPath}
                display="flex"
                style={{
                  width: '100%', alignItems: 'center', gap: 8,
                  padding: '7px 10px', borderRadius: 7,
                  background: currentPath === settingsPath ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.82)', fontSize: 12.5, fontWeight: 600,
                  fontFamily: 'inherit', boxSizing: 'border-box',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.14)'}
                onMouseLeave={e => e.currentTarget.style.background = currentPath === settingsPath ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)'}
              >
                <SettingsIcon size={13} color="rgba(255,255,255,0.75)" />
                Paramètres de l'app
              </LinkBox>
            )}
          </div>
        );
      })()}

      {/* Menu interne de l'app (optionnel) */}
      {!collapsed && appMenu && (
        <div style={{ padding: '14px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          {appMenu}
        </div>
      )}

      {/* Liste des apps — zone flexible qui occupe l'espace restant et défile si
          besoin (desktop ET mobile). Auparavant le desktop utilisait un spacer
          flex:1 + maxHeight:55vh : sur un écran pas assez haut, la somme des blocs
          dépassait 100vh et la liste, plafonnée à 55vh sous le spacer, se
          retrouvait repoussée sous le bord bas de l'aside (non défilant) → apps
          invisibles. Le bouton « Paramètres de l'app » (propre aux Tickets)
          suffisait à faire basculer cet app-là dans le débordement. flex:1 +
          minHeight:0 rend la liste toujours visible et défilable. */}
      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: collapsed ? '14px 0' : '14px 12px',
      }}>
        {!collapsed && (
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
        )}

        {orderedApps.filter(a => accessibleKeys.includes(a.key)).map(app => {
          const { Icon, color, path, label, key } = app;
          const isDrag = draggingKey === key;
          const isOver = overKey === key && draggingKey !== key;
          const isActive = currentPath === path || currentPath?.startsWith(path + '/');
          return (
            <a
              key={key}
              href={path}
              draggable={false}
              onDragStart={e => e.preventDefault()}
              // Drag-sort par pointeur : desktop seulement. Sur mobile on n'attache
              // pas ces handlers pour laisser le défilement tactile fonctionner.
              {...(mobile ? {} : {
                onPointerDown: e => onPointerDown(e, key),
                onPointerEnter: () => onPointerEnter(key),
                onPointerUp: e => onPointerUp(e, key),
              })}
              onClick={e => {
                if (draggingKey) { e.preventDefault(); return; }
                if (e.metaKey || e.ctrlKey || e.shiftKey) {
                  // Laisse le navigateur ouvrir un nouvel onglet (comportement natif sur <a>)
                  return;
                }
                e.preventDefault();
                navigate(path);
              }}
              title={collapsed ? label : undefined}
              className={`sb-app-row${isDrag ? ' dragging' : ''}${isOver ? ' drag-over' : ''}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap: 11,
                padding: collapsed ? '9px 0' : '9px 10px',
                borderRadius: 8,
                marginBottom: 1,
                background: isActive ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: isActive ? C.blanc : 'rgba(255,255,255,0.72)',
                fontSize: 13.5,
                fontWeight: isActive ? 700 : 500,
                cursor: mobile ? 'pointer' : (isDrag ? 'grabbing' : 'grab'),
                userSelect: 'none',
                // touchAction 'none' bloque le scroll tactile → uniquement desktop (drag)
                touchAction: mobile ? 'auto' : 'none',
                textDecoration: 'none',
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
              {!collapsed && (
                <span style={{
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: 1,
                  minWidth: 0,
                }}>
                  {label}
                </span>
              )}
            </a>
          );
        })}
      </div>

      {/* Compte */}
      <div style={{ padding: collapsed ? '12px 0 6px' : '12px 12px 6px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
        {!collapsed && (
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
        )}

        <Link
          to="/settings"
          className="sb-app-row"
          title={collapsed ? 'Paramètres' : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 11,
            padding: collapsed ? '9px 0' : '9px 10px',
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
          {!collapsed && <span>Paramètres</span>}
        </Link>

        <button
          onClick={onLogout}
          className="sb-app-row"
          title={collapsed ? 'Se déconnecter' : undefined}
          style={{
            width: '100%',
            textAlign: 'left',
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            gap: 11,
            padding: collapsed ? '9px 0' : '9px 10px',
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
          {!collapsed && <span>Se déconnecter</span>}
        </button>
      </div>

      {/* Footer user */}
      <div style={{
        padding: collapsed ? '14px 0' : '14px 16px',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 11,
      }}>
        <div
          title={collapsed ? (user?.email ?? '') : undefined}
          style={{
            width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
            background: `linear-gradient(135deg, ${C.orange} 0%, ${shade(C.orange, -0.2)} 100%)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 800, color: C.blanc,
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
          }}
        >
          {initial}
        </div>
        {!collapsed && (
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
        )}
      </div>
    </aside>
  );
}

/* ─── PREFS (localStorage + API) ─────────────────────────── */
const PREFS_KEY = 'yv.home.prefs.v1';
const DEFAULT_PREFS = { appOrder: APPS.map(a => a.key), tileSize: 'comfortable', gridCols: 4, sidebarCollapsed: false };
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
  // On passe l'ordre AFFICHÉ complet (orderedApps), pas prefs.appOrder : les apps
  // récemment ajoutées au registre absentes du localStorage/BDD ne sont pas dans
  // prefs.appOrder, donc indexOf() y renvoyait -1 et leur drag était ignoré.
  const displayedOrder = useMemo(() => orderedApps.map(a => a.key), [orderedApps]);
  const { draggingKey, overKey, onPointerDown, onPointerEnter, onPointerUp, onPointerMove, onPointerCancel } = useDragSort(displayedOrder, handleReorder);

  const handleLogout = () => { logout(); navigate('/login'); };

  const collapsed = prefs.sidebarCollapsed === true;
  const toggleCollapse = useCallback(() => updatePrefs({ sidebarCollapsed: !collapsed }), [updatePrefs, collapsed]);

  // ─── Mobile : la sidebar devient un tiroir ouvert par un hamburger ──────────
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  // App active (pour le titre de la barre supérieure mobile)
  const activeApp = APPS.find(a => currentPath === a.path || currentPath?.startsWith(a.path + '/'));
  // Toute navigation inter-app remonte un AppShell neuf (navOpen=false) ; on
  // ferme aussi le tiroir si le chemin change au sein du même shell.
  useEffect(() => { setNavOpen(false); }, [currentPath]);

  // Props communes de la sidebar (collapsed forcé à false en tiroir mobile).
  const sidebarProps = {
    user, orderedApps, accessibleKeys, draggingKey, overKey,
    onPointerDown, onPointerEnter, onPointerUp,
    onLogout: handleLogout, navigate, currentPath, appMenu,
  };

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

        /* ── Mobile (≤768px) : empêcher le défilement horizontal de la PAGE.
           Le contenu reste dans la largeur de l'écran (plus de dérive diagonale
           en scrollant), et toute table large devient son propre conteneur à
           défilement horizontal — donc consultable sans déformer la page.
           Aucune incidence sur desktop (règle sous media query). ── */
        @media (max-width: 768px) {
          html, body { overflow-x: hidden; max-width: 100vw; }
          /* La page occupe la hauteur sous la barre supérieure mobile (flex:1),
             pas 100vh : sinon le contenu déborde de 48px sous la barre. */
          .main-scroll { overflow-x: hidden; height: 100% !important; }
          .main-scroll table {
            display: block;
            max-width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
        }
      `}</style>
      <div
        style={{ display: 'flex', minHeight: '100vh', background: '#F2F6F8', fontFamily: "'Lato', sans-serif" }}
        onPointerMove={onPointerMove}
        onPointerUp={e => onPointerUp(e, overKey)}
        onPointerCancel={onPointerCancel}
      >
        {isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', width: '100%', minWidth: 0 }}>
            {/* Barre supérieure mobile : hamburger + nom de l'app. Le contenu vit
                en dessous (flex:1), donc le hamburger ne recouvre jamais la page. */}
            <header style={{
              flexShrink: 0, height: 48, display: 'flex', alignItems: 'center', gap: 10,
              padding: '0 8px', background: C.saphirF, color: '#fff', zIndex: 40,
              boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
            }}>
              <button
                onClick={() => setNavOpen(true)}
                aria-label="Ouvrir le menu"
                style={{
                  width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                  background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
                }}
              >
                <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
                  <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
              <span style={{
                fontWeight: 800, fontSize: 16, fontFamily: "'Tilt Warp', cursive",
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {activeApp?.label || 'YouVape'}
              </span>
            </header>
            <Drawer open={navOpen} onClose={() => setNavOpen(false)} side="left" width={260} zIndex={2000}>
              <Sidebar {...sidebarProps} collapsed={false} mobile onToggleCollapse={() => setNavOpen(false)} />
            </Drawer>
            <div style={{ flex: 1, minHeight: 0, width: '100%', position: 'relative' }}>
              {children}
            </div>
          </div>
        ) : (
          <>
            <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapse={toggleCollapse} />
            {children}
          </>
        )}
      </div>
    </>
  );
}
