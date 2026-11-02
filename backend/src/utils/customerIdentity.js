/**
 * Reconnaître un client signalé, même sous un nouveau compte.
 *
 * Pur (sans base) : dishonestCustomerModel fournit les données, ce module dit
 * si elles désignent la même personne. Quatre critères, dans cet ordre — le
 * premier qui correspond est celui qu'on affiche :
 *   - compte    : même compte WordPress ;
 *   - email     : même adresse, sans casse ni espaces ;
 *   - telephone : mêmes 9 derniers chiffres (06…, +33 6…, 0033 6… se valent) ;
 *   - nom       : même nom et prénom, sans casse, accents, tirets ni ordre
 *                 (« Jean-Pierre DUPONT » = « dupont jean pierre »).
 *
 * Le nom donne des homonymes (2 418 comptes sur 53 527 en partagent un avec
 * un autre compte au 02/11/2026) : c'est pourquoi le critère est toujours dit.
 */

const CRITERIA = ['compte', 'email', 'telephone', 'nom'];

const CRITERIA_LABELS = Object.freeze({
  compte: 'même compte',
  email: 'même email',
  telephone: 'même téléphone',
  nom: 'même nom et prénom'
});

const normEmail = (email) => String(email ?? '').trim().toLowerCase() || null;

const normPhone = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const last = digits.slice(-9);
  // 000000000, 111111111… : numéro de remplissage, pas un téléphone.
  return /^(\d)\1+$/.test(last) ? null : last;
};

const normNamePart = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z]/g, '');

/** Clé nom + prénom, indépendante de l'ordre ; null si l'un manque. */
const nameKey = (first, last) => {
  const a = normNamePart(first);
  const b = normNamePart(last);
  if (a.length < 2 || b.length < 2) return null;
  return [a, b].sort().join('|');
};

/**
 * Ce qu'on sait d'un client signalé, normalisé une fois pour toutes.
 * @param {{ wpUserId, emails?: string[], phones?: string[], names?: Array<[string, string]> }} raw
 */
const buildSignature = ({ wpUserId, emails = [], phones = [], names = [] }) => ({
  wpUserId: wpUserId == null ? null : String(wpUserId),
  emails: new Set(emails.map(normEmail).filter(Boolean)),
  phones: new Set(phones.map(normPhone).filter(Boolean)),
  names: new Set(names.map(([f, l]) => nameKey(f, l)).filter(Boolean))
});

/**
 * Le premier critère par lequel `identity` (une commande, un compte) rejoint
 * `signature`, avec la valeur telle qu'écrite dans `identity` ; null sinon.
 *
 * @param {{ wpUserId?, emails?: string[], phones?: string[], names?: Array<[string, string]> }} identity
 * @returns {?{ matchedBy: string, matchedValue: ?string }}
 */
const matchSignature = (identity, signature) => {
  if (identity.wpUserId != null && signature.wpUserId != null
    && String(identity.wpUserId) === signature.wpUserId) {
    return { matchedBy: 'compte', matchedValue: null };
  }
  for (const e of identity.emails || []) {
    if (signature.emails.has(normEmail(e))) return { matchedBy: 'email', matchedValue: normEmail(e) };
  }
  for (const p of identity.phones || []) {
    const n = normPhone(p);
    if (n && signature.phones.has(n)) return { matchedBy: 'telephone', matchedValue: String(p).trim() };
  }
  for (const [f, l] of identity.names || []) {
    const k = nameKey(f, l);
    if (k && signature.names.has(k)) {
      return { matchedBy: 'nom', matchedValue: [f, l].map(s => String(s).trim()).join(' ') };
    }
  }
  return null;
};

/** « même téléphone (06 12 34 56 78) », pour le badge et le ticket. */
const describeMatch = ({ matchedBy, matchedValue }) => `${CRITERIA_LABELS[matchedBy] || matchedBy}`
  + `${matchedValue ? ` (${matchedValue})` : ''}`;

module.exports = {
  CRITERIA, CRITERIA_LABELS, normEmail, normPhone, nameKey, buildSignature, matchSignature, describeMatch
};
