import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/dateUtils';

// ─── Catalogue des balises {{...}} — fetché depuis le backend ────────────────
// Cache module-level pour ne pas refetcher à chaque montage.
let _cache = null;
let _promise = null;

export function fetchPlaceholders() {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = fetch('/api/sav/macros/placeholders')
    .then(r => r.json())
    .then(d => {
      if (d.success) { _cache = d.placeholders; return d.placeholders; }
      return [];
    })
    .catch(() => []);
  return _promise;
}

export function useMacroPlaceholders() {
  const [groups, setGroups] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);
  useEffect(() => {
    if (_cache) return;
    fetchPlaceholders().then(g => { setGroups(g); setLoading(false); });
  }, []);
  return { groups, loading };
}

// Map traduction de statut WC -> label français (aligné sur OrderCard).
const WC_STATUS_LABELS = {
  'wc-completed':         'Livrée',
  'wc-delivered':         'Livrée',
  'wc-being-delivered':   'En livraison',
  'wc-awaiting-delivery': 'En attente de livraison',
  'wc-processing':        'En cours',
  'wc-shipped':           'Expédiée',
  'wc-cancelled':         'Annulée',
  'wc-failed':            'Échouée',
  'wc-refunded':          'Remboursée',
  'wc-on-hold':           'En attente',
  'wc-pending':           'En attente',
  'wc-checkout-draft':    'Brouillon',
  'wc-return-approved':   'Retour accepté',
  'wc-return-cancelled':  'Retour annulé',
};

function fmtMoney(v) {
  if (v === null || v === undefined || v === '') return '';
  const n = parseFloat(v);
  if (Number.isNaN(n)) return '';
  return `${n.toFixed(2)} €`;
}

// ─── Construction du contexte de substitution ───────────────────────────────
// Utilisé par TicketDetail (ticket déjà chargé) et NewTicketPage (form local).
// Tous les paramètres sont optionnels — ce qui manque sera substitué par "".
export function buildPlaceholderContext({ ticket, agent, order, statusMap }) {
  const ctx = {};

  // Ticket
  if (ticket) {
    ctx['ticket.id']             = ticket.id ? String(ticket.id) : '';
    ctx['ticket.subject']        = ticket.subject || '';
    ctx['ticket.sav_status']     = statusMap?.[ticket.sav_status]?.label || ticket.sav_status || '';
    ctx['ticket.order_id']       = ticket.order_id || '';
    ctx['ticket.order_tracking'] = ticket.order_tracking || ticket.order_tracking_from_order || '';
  }

  // Client — accepte deux formes :
  //  - {first_name, last_name, email, phone}        (NewTicketPage form)
  //  - {customer_first_name, customer_last_name, customer_email, customer_phone}  (TicketDetail ticket)
  if (ticket) {
    const fn = ticket.first_name || ticket.customer_first_name
      || (ticket.customer_name ? ticket.customer_name.split(' ')[0] : '');
    const ln = ticket.last_name || ticket.customer_last_name
      || (ticket.customer_name ? ticket.customer_name.split(' ').slice(1).join(' ') : '');
    ctx['client.first_name'] = fn || '';
    ctx['client.last_name']  = ln || '';
    ctx['client.name']       = ticket.customer_name || `${fn} ${ln}`.trim() || '';
    ctx['client.email']      = ticket.customer_email || ticket.customer_email_db || '';
    ctx['client.phone']      = ticket.customer_phone || '';
  }

  // Commande (peut être passée explicitement, ou dérivée du ticket)
  const od = order || (ticket && (ticket.order_wp_id || ticket.order_id) ? {
    wp_order_id:     ticket.order_wp_id || ticket.order_id,
    order_total:     ticket.order_total,
    post_date:       ticket.order_date,
    post_status:     ticket.order_status,
    tracking_number: ticket.order_tracking_from_order || ticket.order_tracking,
    shipping_carrier: ticket.order_carrier,
  } : null);
  if (od) {
    ctx['commande.id']            = od.wp_order_id ? String(od.wp_order_id) : '';
    ctx['commande.total']         = fmtMoney(od.order_total);
    ctx['commande.date']          = od.post_date ? formatDate(od.post_date) : '';
    ctx['commande.statut']        = WC_STATUS_LABELS[od.post_status] || od.post_status?.replace('wc-', '') || '';
    ctx['commande.suivi']         = od.tracking_number || '';
    ctx['commande.transporteur']  = od.shipping_carrier || '';
  }

  // Agent
  if (agent) {
    ctx['agent.name']  = agent.name || '';
    ctx['agent.email'] = agent.email || '';
  }

  return ctx;
}

// ─── Substitution {{xxx.yyy}} ────────────────────────────────────────────────
// Remplace toutes les balises {{key}} par la valeur correspondante du contexte.
// Si la clé n'existe pas dans le contexte → remplace par chaîne vide.
// `escapeFn` (optionnel) : appliqué à chaque valeur substituée. Indispensable
// quand `text` est du HTML (corps de macro riche) pour qu'une valeur contenant
// `<` ou `&` ne casse pas le balisage. Par défaut : identité (sujet, texte brut).
export function applyPlaceholders(text, context, escapeFn) {
  if (!text || typeof text !== 'string') return text || '';
  const esc = typeof escapeFn === 'function' ? escapeFn : (v) => v;
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = context[key];
    return v !== undefined && v !== null ? esc(String(v)) : '';
  });
}

// ─── Balises « à saisir » {{?type:libellé|option|option}} ────────────────────
// Contrairement aux balises ci-dessus (valeurs connues du ticket), celles-ci
// ouvrent une pop-up à l'application de la macro pour que l'agent complète.
//
//   {{?produit}}                       → liste des produits de la commande liée
//   {{?produit:Article défectueux}}    → idem, avec un libellé personnalisé
//   {{?texte:Nom du produit}}          → champ texte libre
//   {{?choix:Délai|48h|5 jours}}       → liste déroulante d'options figées
//   {{?date:Date de renvoi}}           → sélecteur de date
//
// Le `?` empêche toute collision avec le regex des balises standard, qui
// n'accepte que [\w.] — les deux passes de substitution sont indépendantes.
export const INPUT_TYPES = {
  produit: { defaultLabel: 'Produit concerné' },
  texte:   { defaultLabel: 'Valeur à saisir' },
  choix:   { defaultLabel: 'Choix' },
  date:    { defaultLabel: 'Date' },
};

// Nouvelle instance à chaque appel : un regex /g partagé garde un `lastIndex`
// entre les appels et sauterait des occurrences.
const inputTagRe = () => /\{\{\s*\?\s*(produit|texte|choix|date)\s*(?::([^{}]*))?\}\}/gi;

// Les corps de macro sont du HTML (Tiptap) : le libellé d'une balise peut donc
// contenir des entités (&nbsp; sur les espaces multiples, &amp;, apostrophes…).
// On les décode pour afficher un libellé propre dans la pop-up.
// `&amp;` en dernier, sinon `&amp;nbsp;` deviendrait un espace.
function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0?39;|&#x27;/gi, "'")
    .replace(/&amp;/gi, '&');
}

// Construit le descriptif de champ correspondant à une occurrence de balise.
// `id` sert de clé de déduplication : une même balise utilisée deux fois dans
// la macro ne pose qu'une seule question, et remplit les deux emplacements.
function fieldFromMatch(type, rest) {
  const t = String(type).toLowerCase();
  const parts = decodeEntities(rest || '').split('|').map(p => p.trim());
  const label = parts[0] || INPUT_TYPES[t].defaultLabel;
  const options = t === 'choix' ? parts.slice(1).filter(Boolean) : [];
  const id = `${t}:${label.toLowerCase()}${options.length ? `|${options.join('|')}` : ''}`;
  return { id, type: t, label, options };
}

// Extrait les champs à saisir d'un ou plusieurs textes (sujet + body), dans
// l'ordre d'apparition et sans doublon. Retourne [] si la macro n'en a aucun.
export function parseInputTags(...texts) {
  const fields = [];
  const seen = new Set();
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    const re = inputTagRe();
    let m;
    while ((m = re.exec(text)) !== null) {
      const field = fieldFromMatch(m[1], m[2]);
      if (seen.has(field.id)) continue;
      seen.add(field.id);
      fields.push(field);
    }
  }
  return fields;
}

// Substitue les balises à saisir par les réponses de l'agent (map id → valeur).
// `escapeFn` : même contrat que applyPlaceholders — indispensable sur du HTML.
export function applyInputTags(text, answers, escapeFn) {
  if (!text || typeof text !== 'string') return text || '';
  const esc = typeof escapeFn === 'function' ? escapeFn : (v) => v;
  return text.replace(inputTagRe(), (_, type, rest) => {
    const v = answers?.[fieldFromMatch(type, rest).id];
    return v !== undefined && v !== null ? esc(String(v)) : '';
  });
}

// Garde-fou avant envoi : détecte les {{...}} restés en clair dans un texte.
// Cas couverts : balise mal orthographiée dans une macro (elle ne matche alors
// aucun des deux regex et traverse la substitution), brouillon repris, copier-
// coller manuel. Retourne les balises fautives dédupliquées, [] si tout est bon.
export function findUnresolvedTags(...texts) {
  const found = [];
  for (const text of texts) {
    if (!text || typeof text !== 'string') continue;
    const m = text.match(/\{\{[^{}]{0,160}\}\}/g);
    if (m) found.push(...m.map(t => decodeEntities(t)));
  }
  return [...new Set(found)];
}
