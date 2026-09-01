import DOMPurify from 'dompurify';

export const PROCESS_COLOR = '#9333EA';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000/api/auth').replace('/auth', '');

export const C = {
  process: PROCESS_COLOR, processF: '#6B21A8', processL: '#F5EDFF',
  vert: '#4AB866', rouge: '#DE2020', orange: '#E28F00', bleu: '#0071EB',
  grisTL: '#F2F6F8', grisCL: '#E2E2E2', grisM: '#8A99A4', grisF: '#626E85',
  grisTF: '#2a2e38', blanc: '#FFFFFF',
};

export const STATUSES = [
  { code: 'draft',     label: 'Brouillon', color: '#8A99A4', hint: 'En cours de rédaction' },
  { code: 'published', label: 'Publié',    color: '#4AB866', hint: 'Validé, à suivre tel quel' },
  { code: 'archived',  label: 'Archivé',   color: '#626E85', hint: 'Obsolète, gardé pour mémoire' },
];
export const statusInfo = (code) => STATUSES.find((s) => s.code === code) || STATUSES[0];

// Encadrés d'une étape — le point qui doit sauter aux yeux dans une procédure.
export const CALLOUTS = [
  { code: 'info',    label: 'Bon à savoir', color: '#0071EB', bg: '#EAF3FE', icon: 'ℹ️' },
  { code: 'warning', label: 'Attention',    color: '#E28F00', bg: '#FDF4E3', icon: '⚠️' },
  { code: 'danger',  label: 'Irréversible', color: '#DE2020', bg: '#FDECEC', icon: '⛔' },
];
export const calloutInfo = (code) => CALLOUTS.find((c) => c.code === code) || null;

/**
 * Sanitise le HTML d'une étape avant injection dans le DOM.
 *
 * Allowlist plus large que celle du SAV (components/tickets/richText.js) : une
 * procédure a besoin de sous-titres, de code (chemins, requêtes SQL) et de
 * citations. Contrairement au SAV, ce contenu ne vient jamais de l'extérieur —
 * il est écrit par un utilisateur authentifié en écriture — mais on sanitise
 * quand même, par principe.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'span',
  'h3', 'h4', 'code', 'pre', 'blockquote', 'hr',
];
const ALLOWED_ATTR = ['href', 'target', 'rel'];

export function sanitizeProcessHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
  if (typeof document === 'undefined') return clean;
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  tpl.content.querySelectorAll('a').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return tpl.innerHTML;
}

/** Un contenu Tiptap « vide » vaut '<p></p>' : on ne veut pas l'afficher. */
export const hasContent = (html) =>
  !!html && html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0;

/**
 * Date PostgreSQL → « 01/09/2026 à 14:32 ».
 * Les timestamps sont stockés sans fuseau : on les lit tels quels plutôt que de
 * les faire passer par UTC (même précaution que frontend/src/utils/dateUtils.js).
 */
export function prettyDateTime(value) {
  if (!value) return '—';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return s.slice(0, 10);
  const [, y, mo, d, h, mi] = m;
  return `${d}/${mo}/${y} à ${h}:${mi}`;
}

export function prettyDate(value) {
  if (!value) return '—';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s.slice(0, 10);
}

/** « Pierre Merle » → « PM » pour les pastilles d'auteur. */
export function initials(name, email) {
  const source = (name || email || '?').trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
