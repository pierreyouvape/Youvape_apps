import { API_URL, C, Chip } from '../picking/pickingUi';

/** Retours client — libellés et petits éléments partagés (app, ticket, commande). */

export const RETURNS_API = `${API_URL}/retours`;
export const RETURNS_COLOR = '#A21CAF';
export const RETURNS_COLOR_L = '#FAE8FF';

export const REASONS = {
  defaut: 'Défaut',
  erreur_expedition: "Erreur d'expédition",
  retractation: 'Rétractation',
  non_recupere: 'Commande non récupérée',
};

export const OUTCOMES = {
  renvoi: 'Renvoi',
  points: 'Points fidélité',
  remboursement: 'Remboursement',
  aucune: 'Aucune',
};

/** Issue proposée selon le motif (modifiable). */
export const DEFAULT_OUTCOME = {
  defaut: 'renvoi',
  erreur_expedition: 'renvoi',
  retractation: 'remboursement',
  non_recupere: 'points',
};

/** Ce que la référence de l'issue doit contenir. */
export const OUTCOME_REF_HINT = {
  renvoi: 'N° de la commande de renvoi',
  points: 'Nombre de points crédités',
  remboursement: 'Montant remboursé',
  aucune: 'Précision (facultatif)',
};

export const STATUS = {
  attente: { label: 'En attente du colis', color: C.amber, bg: C.amberL },
  recu: { label: 'Reçu', color: C.blue, bg: C.blueL },
  traite: { label: 'Traité', color: C.green, bg: C.greenL },
  annule: { label: 'Annulé', color: C.greyT, bg: '#F3F4F6' },
};

export const StatusChip = ({ status }) => {
  const s = STATUS[status] || STATUS.attente;
  return <Chip color={s.color} bg={s.bg}>{s.label}</Chip>;
};

export const btn = (variant = 'primary', disabled = false) => ({
  padding: '8px 14px', borderRadius: 8, fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit',
  cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1,
  border: variant === 'ghost' ? `1px solid ${C.greyB}` : 'none',
  background: variant === 'primary' ? RETURNS_COLOR : variant === 'danger' ? C.red : C.white,
  color: variant === 'ghost' ? C.dark : C.white,
});

export const field = {
  padding: '7px 9px', borderRadius: 7, border: `1px solid ${C.greyB}`, fontSize: 13.5,
  fontFamily: 'inherit', background: C.white, boxSizing: 'border-box',
};

export const errorText = (e) => e?.response?.data?.error || e?.message || 'Erreur';

export const customerName = (r) =>
  [r.billing_first_name, r.billing_last_name].filter(Boolean).join(' ') || r.billing_email || '—';

export const euro = (n) => (n == null ? '—' : `${Number(n).toFixed(2).replace('.', ',')} €`);
