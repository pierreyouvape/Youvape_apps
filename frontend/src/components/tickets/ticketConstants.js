// ─── Affichage de l'identifiant d'un ticket ───────────────────────────────────
// Les tickets importés de Zendesk ont un id = leur id Zendesk (≤ ~10M).
// Les tickets de test internes vivent dans une plage haute (≥ 90 000 000) et
// sont affichés « TEST-xxx » pour être reconnaissables sans risque de collision.
export const TEST_ID_THRESHOLD = 90000000;
export function formatTicketId(id) {
  if (id == null) return '';
  return id >= TEST_ID_THRESHOLD ? `TEST-${id - TEST_ID_THRESHOLD}` : `#${id}`;
}

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

// ─── Blocage d'expéditeur (classement spam) ──────────────────────────────────
// Fournisseurs de boîtes grand public : bloquer un de ces domaines classerait en
// spam toutes les demandes publiques d'un client sur quatre. La sonde de relais
// du 13/08/2026 utilisait précisément gmail, outlook, aol et yahoo — l'option
// « bloquer le domaine » doit donc rester interdite, pas seulement déconseillée.
export const PUBLIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.fr', 'hotmail.com', 'hotmail.fr',
  'live.fr', 'live.com', 'msn.com', 'yahoo.com', 'yahoo.fr', 'ymail.com', 'aol.com',
  'icloud.com', 'me.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net',
  'bbox.fr', 'numericable.fr', 'gmx.com', 'gmx.us', 'gmx.fr', 'protonmail.com', 'proton.me',
  'zohomail.eu', 'skynet.be', 'telenet.be', 'voo.be',
]);

// Découpe une adresse en { email, domain } normalisés, et dit si son domaine est
// blocable. Partagé par la modale du ticket et celle de l'action groupée.
export function senderBlockInfo(rawEmail) {
  const email = (rawEmail || '').trim().toLowerCase();
  const domain = email.includes('@') ? email.split('@').pop() : '';
  return { email, domain, domainBlockable: !!domain && !PUBLIC_MAIL_DOMAINS.has(domain) };
}

// ─── Vues prédéfinies (sidebar gauche) ───────────────────────────────────────
export const DEFAULT_VIEWS = [
  { id: 'ouvert',   label: 'Ouverts',   status: 'ouvert' },
  { id: 'accepté',  label: 'Acceptés',  status: 'accepté' },
  { id: 'terminé',  label: 'Résolus',   status: 'terminé' },
  { id: 'refusé',   label: 'Refusés',   status: 'refusé' },
  { id: 'all',      label: 'Tous',      status: null },
];
