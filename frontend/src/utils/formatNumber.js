// Espaces insécables utilisées comme séparateur de milliers par Intl (fr-FR) :
// espace fine insécable (U+202F) et espace insécable (U+00A0).
// On les remplace par une espace normale, plus lisible dans nos tableaux.
const NBSP = /[\u202f\u00a0]/g;

/**
 * Formate un nombre avec séparateur de milliers (espace) et virgule décimale
 * Ex: 37440.11 → "37 440,11"
 */
export const formatPrice = (value) => {
  const num = parseFloat(value || 0);
  return num
    .toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(NBSP, ' ');
};

/**
 * Formate un prix avec le symbole €
 * Ex: 37440.11 → "37 440,11 €"
 */
export const formatPriceEur = (value) => {
  return formatPrice(value) + ' €';
};

/**
 * Formate un entier avec séparateur de milliers
 * Ex: 5301 → "5 301"
 */
export const formatInt = (value) => {
  const num = parseInt(value || 0);
  return num.toLocaleString('fr-FR').replace(NBSP, ' ');
};
