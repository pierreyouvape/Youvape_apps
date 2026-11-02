/**
 * Contrat Mollie (proposition commerciale signée le 29/01/2026, DocuSign
 * B241EC0D-F294-4947-B7BF-969233A31F2B) : grille tarifaire et échéances.
 *
 * Source de vérité du contrôle des factures (services/mollieAuditService.js).
 * Une hausse notifiée par Mollie = ajouter une grille datée ici, jamais
 * modifier une grille existante (les anciennes factures doivent rester justes).
 *
 * fixed = € par transaction, pct = % du montant. Hors TVA (autoliquidation).
 */

const CONTRACT = {
  signedAt: '2026-01-29',
  effectiveFrom: '2026-01-29',
  durationMonths: 18,
  endsAt: '2027-07-29',
  // Résiliation : préavis de 3 mois avant la fin, sinon renouvellement de 12 mois.
  noticeDeadline: '2027-04-29',
  // Clause inflation : jamais dans les 9 premiers mois (→ 29/10/2026), seulement
  // au début d'un trimestre civil, 1 fois par an, +2 % à +5 %, notifiée 1 mois avant.
  inflationEarliest: '2027-01-01',
  minimumInvoice: 0,
};

// Grilles successives. `to` exclu. Les lignes « hors contrat » (Alma, Pay by
// Bank, remboursements) suivent le tarif standard Mollie relevé sur les
// factures : un changement y est signalé en avertissement, pas en anomalie.
const GRIDS = [
  {
    // « Prix actuel » de la proposition du 29/01/2026, vérifié sur la facture de
    // déc. 2025. Avant, aucune grille connue : les taux ne sont pas contrôlés.
    label: 'Tarif avant contrat',
    from: '2025-12-01',
    to: '2026-01-29',
    rates: {
      card_consumer:   { fixed: 0.14,  pct: 0.60 },
      card_commercial: { fixed: 0.25,  pct: 2.90 },
      card_non_eea:    { fixed: 0.25,  pct: 3.25 },
      amex:            { fixed: 0.14,  pct: 2.20 },
      cb:              { fixed: 0.14,  pct: 0.60 },
      bancontact:      { fixed: 0.25,  pct: 1.40 },
      threeds:         { fixed: 0.04 },
    },
  },
  {
    label: 'Contrat du 29/01/2026',
    from: '2026-01-29',
    to: '2100-01-01',
    rates: {
      card_consumer:   { fixed: 0.132, pct: 0.56 },
      card_commercial: { fixed: 0.25,  pct: 2.90 },
      card_non_eea:    { fixed: 0.25,  pct: 3.25 },
      amex:            { fixed: 0.134, pct: 2.17 },
      cb:              { fixed: 0.132, pct: 0.57 },
      bancontact:      { fixed: 0.228, pct: 1.33 },
      threeds:         { fixed: 0.04 },
    },
  },
];

// Tarif standard hors contrat, relevé sur les factures de sept. et oct. 2026,
// puis daté à chaque changement notifié par Mollie. Seules les clés changées
// figurent dans une grille ultérieure ; les autres restent celles de la base.
// `notice` = changement annoncé par écrit : le tarif devient opposable, un
// écart en notre défaveur passe d'avertissement à anomalie.
const REFERENCE_GRIDS = [
  {
    label: 'Tarif standard relevé (déc. 2025 – oct. 2026)',
    from: '2025-12-01',
    to: '2100-01-01',
    rates: {
      amex_non_eea: { fixed: 0.25, pct: 2.9 },
      chargeback: { fixed: 25 },
      alma_be_3x: { fixed: 0.35, pct: 4.29 },
      alma_fr_3x: { fixed: 0.10, pct: 4.1 },
      alma_fr_4x: { fixed: 0.10, pct: 4.99 },
      paybybank:  { fixed: 0.15, pct: 0.8 },
      refund:     { fixed: 0.25 },
    },
  },
  {
    label: 'Pay by Bank 0,45 % (mail Mollie, 01/12/2026)',
    notice: 'Mail Mollie : « À partir du 1er décembre 2026, vous paierez 0.45% + 0.15 EUR par transaction Pay by Bank ».',
    from: '2026-12-01',
    to: '2100-01-01',
    rates: {
      paybybank: { fixed: 0.15, pct: 0.45 },
    },
  },
];

// Libellés de la grille, dans l'ordre du contrat.
const RATE_LABELS = {
  cb:              'Carte Bancaire (domestique)',
  card_consumer:   'Visa/Mastercard particulier (France + EEE)',
  card_commercial: 'Visa/Mastercard commerciale EEE',
  card_non_eea:    'Visa/Mastercard hors EEE',
  amex:            'American Express EEE',
  bancontact:      'Bancontact',
  threeds:         'Tentative 3DS (cartes)',
  alma_be_3x:      'Alma 3x Belgique',
  alma_fr_3x:      'Alma 3x France',
  alma_fr_4x:      'Alma 4x France',
  paybybank:       'Pay by Bank',
  refund:          'Remboursement',
  amex_non_eea:    'American Express hors EEE',
  chargeback:      'Rétrofacturation (chargeback)',
  acceptance_risk: 'Frais d\'acceptation et de risque',
  minimum:         'Minimum de facturation',
};

// Moyens de paiement Mollie ↔ libellé WooCommerce de nos commandes.
// « Paiement par carte bancaire » = Systempay, pas Mollie : exclu.
const METHODS = {
  cards:      { label: 'Cartes',      titles: ['Carte Bancaire'] },
  bancontact: { label: 'Bancontact',  titles: ['Bancontact'] },
  alma:       { label: 'Alma (3x/4x)', titles: ['En 3 ou 4x sans frais'] },
  paybybank:  { label: 'Pay by Bank', titles: ['Virement saisie automatique'] },
};

// Statuts d'une commande payée (une commande remboursée a d'abord été payée).
const PAID_STATUSES = [
  'wc-completed', 'wc-processing', 'wc-delivered', 'wc-awaiting-delivery',
  'wc-shipped', 'wc-being-delivered', 'wc-refunded',
];

// Pays de l'Espace économique européen (hors France, traitée à part).
const EEA = ['AT','BE','BG','CY','CZ','DE','DK','EE','ES','FI','GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MT','NL','NO','PL','PT','RO','SE','SI','SK'];
// France + DROM/COM : cartes françaises.
const FR_ZONE = ['FR','GP','MQ','GF','RE','YT','PM','BL','MF','NC','PF','WF','MC'];

module.exports = { CONTRACT, GRIDS, REFERENCE_GRIDS, RATE_LABELS, METHODS, PAID_STATUSES, EEA, FR_ZONE };
