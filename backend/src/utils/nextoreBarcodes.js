/**
 * Codes-barres Nextore.
 *
 * Nextore n'a qu'un champ `barcode` par article et y range plusieurs codes
 * séparés par « ; » (ancien et nouvel emballage d'un même produit). On les
 * éclate pour les stocker un par ligne (nextore_product_barcodes).
 *
 * La normalisation s'applique des deux côtés — code stocké et code scanné — et
 * doit rester identique à celle de la migration add_nextore_product_barcodes.sql.
 */

/**
 * Code tel qu'un lecteur le renvoie : sans espace (une saisie « 147 0208503 »),
 * sans préfixe d'identifiant AIM (« ]C1 » capté par une douchette mal réglée),
 * en majuscules.
 */
function normalizeBarcode(code) {
  return String(code ?? '')
    .replace(/\s+/g, '')
    .replace(/^\][A-Za-z][0-9]/, '')
    .toUpperCase();
}

/** Tous les codes d'un champ barcode Nextore, normalisés et dédoublonnés. */
function splitNextoreBarcodes(raw) {
  if (!raw) return [];
  return [...new Set(String(raw).split(/[;,]/).map(normalizeBarcode).filter(Boolean))];
}

module.exports = { normalizeBarcode, splitNextoreBarcodes };
