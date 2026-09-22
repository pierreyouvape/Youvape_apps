/**
 * Codes-barres employés — série EAN-13 « maison », ouverte le 24/04/2026.
 *
 * Format : 2522 | II | JJ | NNNN | C
 *   2522   préfixe interne. La plage EAN commençant par 2 est réservée à
 *          l'usage interne d'une entreprise : aucun risque de collision avec
 *          un EAN fabricant du catalogue produits.
 *   II     rang alphabétique de l'initiale du prénom (A=01 … Z=26)
 *   JJ     rang alphabétique de l'initiale du nom
 *   NNNN   n° d'ordre dans la série, par ordre de création
 *   C      clé de contrôle EAN-13
 *
 * Les initiales ne font PAS l'unicité (Joël Pozzo et Jean-Baptist Reinaud
 * partagent le J) : c'est le n° d'ordre qui distingue, les initiales ne sont là
 * que pour reconnaître un code à l'œil. Un n° d'ordre n'est jamais réattribué,
 * même après un départ — sinon deux personnes partageraient un code dans
 * l'historique de ce qui aura été scanné.
 *
 * ⚠️ Les 10 premiers codes ont été imprimés AVANT cette app (les SVG d'avril
 * 2026, `~/Documents/Youvape/barcodes_employes_YV/`). Ils sont repris tels
 * quels en base : on ne recalcule jamais un code existant, une étiquette déjà
 * collée ne se met pas à jour.
 */

/** Préfixe de la série. Ne jamais changer : les codes déjà imprimés le portent. */
const PREFIX = '2522';

/** « Gaïa » → « Gaia » : le rang alphabétique se lit sans les accents. */
const stripAccents = (s) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Rang alphabétique de la première lettre d'un nom (A=1 … Z=26).
 * 0 si le nom ne contient aucune lettre latine — le code reste valide,
 * il perd juste son indice visuel.
 */
const letterRank = (name) => {
  const m = stripAccents(name).toUpperCase().match(/[A-Z]/);
  return m ? m[0].charCodeAt(0) - 64 : 0;
};

/**
 * Clé de contrôle EAN-13 : somme pondérée 1/3 des 12 premiers chiffres,
 * complétée à la dizaine supérieure.
 */
const checkDigit = (twelve) => {
  const sum = String(twelve)
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return String((10 - (sum % 10)) % 10);
};

/** Un code de la série est-il bien formé (13 chiffres + clé juste) ? */
const isValidBarcode = (code) => {
  const s = String(code ?? '');
  return /^\d{13}$/.test(s) && checkDigit(s.slice(0, 12)) === s[12];
};

/**
 * Construit le code d'un salarié. `seq` est le n° d'ordre de la série
 * (1..9999), attribué par le modèle et jamais deviné ici.
 */
const buildBarcode = ({ firstName, lastName, seq }) => {
  const n = Number(seq);
  if (!Number.isInteger(n) || n < 1 || n > 9999) {
    throw new Error(`N° d'ordre hors série : ${seq}`);
  }
  const base = PREFIX
    + String(letterRank(firstName)).padStart(2, '0')
    + String(letterRank(lastName)).padStart(2, '0')
    + String(n).padStart(4, '0');
  return base + checkDigit(base);
};

module.exports = { PREFIX, buildBarcode, checkDigit, isValidBarcode, letterRank, stripAccents };
