// ─── Statuts tickets — configurables plus tard depuis les paramètres ──────────
export const TICKET_STATUSES = {
  ouvert:   { label: 'Ouvert',   bg: '#FDEAEA', color: '#B71D1D' },
  'accepté':{ label: 'Accepté',  bg: '#E5EEF6', color: '#2C5F80' },
  terminé:  { label: 'Résolu',   bg: '#E5F4EB', color: '#2A8049' },
  refusé:   { label: 'Refusé',   bg: '#F0F0F0', color: '#626E85' },
};

export const TICKET_STATUS_LIST = Object.entries(TICKET_STATUSES).map(([value, s]) => ({
  value, ...s,
}));

// ─── Couleur accent de l'app tickets ─────────────────────────────────────────
export const TICKETS_COLOR = '#0891B2';

// ─── Vues prédéfinies (sidebar gauche) ───────────────────────────────────────
export const DEFAULT_VIEWS = [
  { id: 'ouvert',   label: 'Ouverts',   status: 'ouvert' },
  { id: 'accepté',  label: 'Acceptés',  status: 'accepté' },
  { id: 'terminé',  label: 'Résolus',   status: 'terminé' },
  { id: 'refusé',   label: 'Refusés',   status: 'refusé' },
  { id: 'all',      label: 'Tous',      status: null },
];
