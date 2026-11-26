import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { APPS } from './AppIcons';

/**
 * Favicon de l'onglet = tuile de l'app affichée (même couleur, même pictogramme
 * que l'accueil) : avec dix onglets ouverts, on retrouve le Packing ou le SAV
 * d'un coup d'œil. Hors app (accueil, connexion…) : le logo YouVape.
 */

const DEFAULT_ICON = '/images/logo.svg';

// Écrans qui ne sont pas une entrée d'APPS mais appartiennent à l'une d'elles.
// Clé = début d'adresse, valeur = clé d'app. Le plus long préfixe gagne.
const ALIASES = {
  '/orders': 'commandes',
  '/products': 'catalog',
  '/brands': 'catalog',
  '/sub-brands': 'catalog',
  '/categories': 'catalog',
  '/sub-categories': 'catalog',
  '/purchases/create-order': 'achats-commandes',
  '/purchases/import-pdf': 'achats-commandes',
  '/seo': 'seo',
  '/pda/boutique/montpellier': 'boutique-mtp',
  '/pda/boutique/castelnau': 'boutique-cast',
  '/pda/inventaire': 'inventaire',
  '/pda': 'picking',
};

const APP_BY_KEY = APPS.reduce((m, a) => { m[a.key] = a; return m; }, {});

// Préfixes candidats, du plus long au plus court.
const PREFIXES = [
  ...APPS.map(a => ({ prefix: a.path, app: a })),
  ...Object.entries(ALIASES).map(([prefix, key]) => ({ prefix, app: APP_BY_KEY[key] })),
]
  .filter(p => p.app)
  .sort((a, b) => b.prefix.length - a.prefix.length);

function appForPath(pathname) {
  const hit = PREFIXES.find(({ prefix }) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return hit ? hit.app : null;
}

function shade(hex, amt) {
  const h = hex.replace('#', '');
  const adj = i => Math.max(0, Math.min(255, Math.round(parseInt(h.slice(i, i + 2), 16) + 255 * amt)));
  return '#' + [0, 2, 4].map(i => adj(i).toString(16).padStart(2, '0')).join('');
}

// Les pictogrammes d'AppIcons sont des fonctions pures (aucun hook) : on les
// déroule en texte SVG sans passer par React DOM.
const ATTR = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin',
  fillRule: 'fill-rule', clipRule: 'clip-rule', strokeDasharray: 'stroke-dasharray', strokeOpacity: 'stroke-opacity',
  fillOpacity: 'fill-opacity', stopColor: 'stop-color', stopOpacity: 'stop-opacity', fontSize: 'font-size', fontWeight: 'font-weight', textAnchor: 'text-anchor' };
const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function toSvg(node) {
  if (node == null || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(toSvg).join('');
  if (typeof node !== 'object') return esc(node);
  const { type, props = {} } = node;
  if (typeof type === 'function') return toSvg(type(props));
  if (typeof type !== 'string') return toSvg(props.children); // Fragment
  const attrs = Object.entries(props)
    .filter(([k, v]) => k !== 'children' && k !== 'style' && v != null && typeof v !== 'function' && typeof v !== 'object')
    .map(([k, v]) => ` ${ATTR[k] || k}="${esc(v)}"`).join('');
  return `<${type}${attrs}>${toSvg(props.children)}</${type}>`;
}

const cache = new Map();
function faviconFor(app) {
  if (cache.has(app.key)) return cache.get(app.key);

  const icon = toSvg(app.Icon({ size: 40, color: '#fff' }))
    // Trait épaissi : à 16 px, le trait de la tuile (1.6) disparaît.
    .replace(/stroke-width="[\d.]+"/g, 'stroke-width="2.3"')
    // Position dans la tuile de 64 × 64.
    .replace('<svg ', '<svg x="12" y="12" ');

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<defs><linearGradient id="yvfav" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0" stop-color="${app.color}"/><stop offset="1" stop-color="${shade(app.color, -0.18)}"/>` +
    '</linearGradient></defs>' +
    '<rect width="64" height="64" rx="14" fill="url(#yvfav)"/>' +
    icon +
    '</svg>';

  const url = 'data:image/svg+xml,' + encodeURIComponent(svg);
  cache.set(app.key, url);
  return url;
}

function setFavicon(href) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.type = 'image/svg+xml';
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

export default function AppFavicon() {
  const { pathname } = useLocation();
  useEffect(() => {
    const app = appForPath(pathname);
    try {
      setFavicon(app ? faviconFor(app) : DEFAULT_ICON);
    } catch {
      setFavicon(DEFAULT_ICON);
    }
  }, [pathname]);
  return null;
}
