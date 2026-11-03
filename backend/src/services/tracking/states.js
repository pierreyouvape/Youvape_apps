/**
 * États communs du suivi des colis, et calcul de l'état d'un colis.
 *
 * Pur (sans base ni réseau) : testé par tests/shipmentTracking.test.js.
 *
 * Chaque transporteur parle sa langue (DI1 chez La Poste, D chez Chronopost,
 * « COLIS LIVRÉ » chez Mondial Relay). `tracking_status_map` traduit chaque
 * code en un de ces états ; l'état d'un colis se déduit ensuite de son journal.
 */

const STATES = {
  label_created:    'Étiquette créée',
  picked_up:        'Pris en charge',
  in_transit:       'En transit',
  out_for_delivery: 'En livraison',
  at_pickup_point:  'En point relais',
  delivery_failed:  'Échec de livraison',
  incident:         'Incident',
  delivered:        'Livré',
  returning:        'Retour vers nous',
  returned:         'Revenu chez nous',
  // Vu, mais sans effet sur l'état (SMS envoyé, livraison reportée…).
  info:             'Information (sans effet)',
};

/** Les états qui arrêtent le suivi : plus rien à attendre du transporteur. */
const FINAL_STATES = ['delivered', 'returned'];

/** Au-delà, un colis n'est plus interrogé, quel que soit son état. */
const MAX_AGE_DAYS = 45;

/** Délai avant le prochain passage, selon l'état (en heures). */
const RECHECK_HOURS = {
  none:             6,   // pas encore d'évènement, ou aucun de classé
  label_created:    6,
  picked_up:        4,
  in_transit:       4,
  out_for_delivery: 1,
  at_pickup_point:  12,
  delivery_failed:  4,
  incident:         4,
  returning:        12,
};

/** Après une erreur (transporteur injoignable, réponse illisible). */
const RETRY_HOURS_ON_ERROR = 1;

/**
 * État d'un colis d'après son journal.
 *
 * Règles :
 *   - on suit les évènements dans l'ordre du temps ; ceux qui ne sont pas
 *     classés (« à classer ») ou classés « information » ne changent rien ;
 *   - **un retour est sans retour arrière** : dès qu'un évènement de retour
 *     apparaît, le colis reste « Retour vers nous », et un « livré » qui suit
 *     devient « Revenu chez nous ». Chronopost renvoie un colis non retiré et
 *     finit par « D Livraison effectuée »… au centre de retour (commande
 *     1264731, 14/10/2026) : sans cette règle, on la croirait livrée au client ;
 *   - **un colis livré le reste**, sauf retour : les évènements qui suivent
 *     une livraison (SMS, doublon de scan) ne la défont pas.
 *
 * @param {{event_key: string, occurred_at: (Date|string)}[]} events
 * @param {(key: string) => (string|null|undefined)} stateOf - état d'un code
 * @returns {{state: ?string, stateAt: ?Date, deliveredAt: ?Date, lastEventAt: ?Date, lastLabel: ?string}}
 */
const computeState = (events, stateOf) => {
  const sorted = [...events].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  let state = null;
  let stateAt = null;
  let deliveredAt = null;
  let returning = false;

  for (const ev of sorted) {
    const mapped = stateOf(ev.event_key);
    if (!mapped || mapped === 'info' || !STATES[mapped]) continue;

    const at = new Date(ev.occurred_at);
    let next = mapped;

    if (mapped === 'returning' || mapped === 'returned') returning = true;

    if (returning) {
      next = (mapped === 'delivered' || mapped === 'returned') ? 'returned' : 'returning';
    } else if (state === 'delivered') {
      continue;
    }

    // Plusieurs scans successifs du même état : la date reste celle du premier.
    if (next !== state) {
      state = next;
      stateAt = at;
    }
    if (next === 'delivered' && !deliveredAt) deliveredAt = at;
  }

  if (state !== 'delivered') deliveredAt = null;

  const last = sorted[sorted.length - 1];
  return {
    state,
    stateAt,
    deliveredAt,
    lastEventAt: last ? new Date(last.occurred_at) : null,
    lastLabel: last ? (last.label || last.event_key) : null,
  };
};

/**
 * Prochain passage : NULL quand le suivi s'arrête (état final, ou colis trop
 * ancien).
 *
 * @param {?string} state
 * @param {Date|string} labelCreatedAt
 * @param {Date} [now]
 * @returns {?Date}
 */
const nextCheckAt = (state, labelCreatedAt, now = new Date()) => {
  if (FINAL_STATES.includes(state)) return null;
  const ageDays = (now - new Date(labelCreatedAt)) / 86400000;
  if (ageDays > MAX_AGE_DAYS) return null;
  const hours = RECHECK_HOURS[state] || RECHECK_HOURS.none;
  return new Date(now.getTime() + hours * 3600000);
};

module.exports = {
  STATES, FINAL_STATES, MAX_AGE_DAYS, RECHECK_HOURS, RETRY_HOURS_ON_ERROR,
  computeState, nextCheckAt,
};
