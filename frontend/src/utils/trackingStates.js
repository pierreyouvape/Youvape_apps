/**
 * États du suivi des colis — mêmes codes que le backend
 * (backend/src/services/tracking/states.js).
 *
 * Couleurs : bleu tant que le colis avance, ocre quand le transporteur annonce
 * un retard, orange quand il attend le client ou a raté une livraison, rouge pour ce qui revient vers nous, vert livré.
 */
export const TRACKING_STATES = {
  label_created:    { label: 'Étiquette créée',     color: '#6c757d' },
  picked_up:        { label: 'Pris en charge',      color: '#0d6efd' },
  in_transit:       { label: 'En transit',          color: '#0d6efd' },
  delayed:          { label: 'Retard déclaré',      color: '#b7791f' },
  out_for_delivery: { label: 'En livraison',        color: '#6610f2' },
  at_pickup_point:  { label: 'En point relais',     color: '#fd7e14' },
  delivery_failed:  { label: 'Échec de livraison',  color: '#e8590c' },
  incident:         { label: 'Incident',            color: '#dc3545' },
  delivered:        { label: 'Livré',               color: '#198754' },
  returning:        { label: 'Retour vers nous',    color: '#dc3545' },
  returned:         { label: 'Revenu chez nous',    color: '#842029' },
};

/** Les états, dans l'ordre du parcours, pour les menus de filtre. */
export const TRACKING_STATE_OPTIONS = Object.entries(TRACKING_STATES)
  .map(([value, s]) => ({ value, label: s.label }));
