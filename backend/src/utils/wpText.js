/**
 * Texte WordPress → texte brut.
 *
 * WooCommerce échappe en HTML le titre qu'il génère pour une déclinaison
 * (« Silver &amp; Black »), et la ligne de commande en hérite. Stocké tel quel,
 * le « &amp; » s'affichait en toutes lettres au PDA, au bon de vague et au
 * packing. On le décode à l'entrée, sur le titre produit et le nom de ligne.
 *
 * @param {string|null|undefined} value
 * @returns {string|null|undefined}
 */
function decodeWpText(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&nbsp;|&#0?160;/gi, ' ')
    .replace(/&amp;|&#0?38;/gi, '&');
}

module.exports = { decodeWpText };
