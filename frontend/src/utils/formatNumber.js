/**
 * Formate un nombre avec séparateur de milliers (espace) et virgule décimale
 * Ex: 37440.11 → "37 440,11"
 */
export const formatPrice = (value) => {
  const num = parseFloat(value || 0);
  return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

/**
 * Formate un prix avec le symbole €
 * Ex: 37440.11 → "37 440,11 €"
 */
export const formatPriceEur = (value) => {
  return formatPrice(value) + ' \u20ac';
};

/**
 * Formate un entier avec séparateur de milliers
 * Ex: 5301 → "5 301"
 */
export const formatInt = (value) => {
  const num = parseInt(value || 0);
  return num.toLocaleString('fr-FR');
};
