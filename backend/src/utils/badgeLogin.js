/**
 * Connexion du PDA par le badge employé (code-barres EAN-13 de Gestion employé).
 *
 * Le badge est un identifiant imprimé, pas un secret, et sa forme se devine
 * (`2522` + initiales + n° d'ordre + clé) : quelques milliers d'essais couvrent
 * toute la série. D'où le frein sur les échecs, par adresse ET au total — une
 * adresse se falsifie (en-têtes), le total non.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP = 10;
const MAX_TOTAL = 60;

/** Le code tel que la douchette l'envoie → 13 chiffres, ou null. */
const normalizeBadge = (raw) => {
  // Certains lecteurs préfixent un identifiant AIM (« ]E0 ») : on ne garde que les chiffres.
  const digits = String(raw ?? '').replace(/^\]E\d/, '').replace(/\D/g, '');
  if (!/^\d{13}$/.test(digits)) return null;
  const sum = digits.slice(0, 12).split('')
    .reduce((s, c, i) => s + Number(c) * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[12]) ? digits : null;
};

/** Compteur d'échecs glissant. Instancié une fois par le contrôleur, à neuf dans les tests. */
const createFailureLimiter = ({ windowMs = WINDOW_MS, maxPerIp = MAX_PER_IP, maxTotal = MAX_TOTAL } = {}) => {
  const byIp = new Map();
  let all = [];
  const prune = (list, now) => list.filter((t) => now - t < windowMs);

  return {
    isBlocked(ip, now = Date.now()) {
      all = prune(all, now);
      const mine = prune(byIp.get(ip) || [], now);
      if (mine.length) byIp.set(ip, mine); else byIp.delete(ip);
      return mine.length >= maxPerIp || all.length >= maxTotal;
    },
    recordFailure(ip, now = Date.now()) {
      all.push(now);
      byIp.set(ip, [...prune(byIp.get(ip) || [], now), now]);
    },
  };
};

module.exports = { normalizeBadge, createFailureLimiter };
