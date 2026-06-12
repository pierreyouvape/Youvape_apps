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
