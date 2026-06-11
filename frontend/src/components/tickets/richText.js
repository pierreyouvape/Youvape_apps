// ─── Helpers texte riche / HTML pour les messages SAV ────────────────────────
// Centralise : conversion de l'ancien format markdown-like → HTML (macros &
// fallback), détection de format, et sanitisation avant injection dans le DOM.
import DOMPurify from 'dompurify';

// Balises autorisées dans un message affiché. Volontairement restrictif :
// les bodies peuvent venir d'un client (inbound email) et contenir du HTML hostile.
const ALLOWED_TAGS = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'span', 'img'];
const ALLOWED_ATTR = ['href', 'target', 'rel', 'src', 'alt'];

// Échappe les caractères HTML d'une chaîne de texte brut.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Détecte si une chaîne contient déjà du HTML (au moins une balise).
// Sert à distinguer les nouveaux messages (HTML, Tiptap) des anciens
// (markdown-like : [texte](url) + sauts de ligne bruts).
export function isHtml(str) {
  if (!str || typeof str !== 'string') return false;
  return /<[a-z][\s\S]*>/i.test(str);
}

// Convertit l'ancien format texte/markdown-like en HTML :
//  - échappe le HTML existant
//  - transforme les liens [texte](url) en <a>
//  - transforme les sauts de ligne en <br>
// Utilisé pour les macros (body plain stocké en BDD) et pour normaliser
// l'ancien format avant édition dans Tiptap.
export function markdownTextToHtml(text) {
  if (!text || typeof text !== 'string') return '';

  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  let out = '';
  let last = 0;
  let match;
  while ((match = linkRe.exec(text)) !== null) {
    out += escapeHtml(text.slice(last, match.index));
    const label = escapeHtml(match[1]);
    const url = escapeHtml(match[2]);
    out += `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    last = match.index + match[0].length;
  }
  out += escapeHtml(text.slice(last));

  return out.replace(/\n/g, '<br>');
}

// Sanitise un HTML avant injection (dangerouslySetInnerHTML).
// Force target=_blank + rel sécurisé sur tous les liens.
export function sanitizeHtml(html) {
  if (!html || typeof html !== 'string') return '';
  const clean = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
  // DOMPurify ne force pas target/rel : on les rajoute sur les <a>.
  if (typeof document !== 'undefined') {
    const tpl = document.createElement('template');
    tpl.innerHTML = clean;
    tpl.content.querySelectorAll('a').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    return tpl.innerHTML;
  }
  return clean;
}
