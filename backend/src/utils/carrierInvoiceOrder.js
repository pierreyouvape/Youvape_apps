/**
 * Ordre des historiques de factures transporteurs : la plus récente en haut.
 *
 * Les dates sont stockées en texte « JJ/MM/AAAA » : un tri sur la colonne brute
 * classerait le 31/01 après le 28/02. On convertit, et on se replie sur ce que
 * chaque transporteur fournit :
 *   - Chronopost, Mondial Relay, Lettre suivie : date de facture ;
 *   - Colissimo : pas de date de facture, fin (puis début) de période ;
 *   - à défaut, date d'import.
 * Mêmes dates (Mondial Relay émet une facture par pays le même jour) : le
 * numéro de facture le plus élevé d'abord.
 *
 * @param {string} alias - alias de carrier_invoices dans la requête (« ci »), ou vide
 * @returns {string} clause à placer après ORDER BY
 */
function newestInvoicesFirst(alias = '') {
  const c = alias ? `${alias}.` : '';
  const date = col => `CASE WHEN ${c}${col} ~ '^\\d{2}/\\d{2}/\\d{4}$' THEN to_date(${c}${col}, 'DD/MM/YYYY') END`;
  return `COALESCE(${date('invoice_date')}, ${date('period_end')}, ${date('period_start')}, ${c}created_at::date) DESC,
          ${c}invoice_number DESC`;
}

// Assez pour tout l'historique d'un transporteur (66 factures Chronopost au
// 07/10/2026 : l'ancienne limite de 50 en masquait 16).
const HISTORY_LIMIT = 500;

module.exports = { newestInvoicesFirst, HISTORY_LIMIT };
